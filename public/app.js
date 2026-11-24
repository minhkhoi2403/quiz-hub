import { mountStudyNavigation, unmountStudyNavigation } from './study-navigation.js';
import { examContent } from './exam-ui.js';
import { nextQuizAction, nextQuizLabel } from './quiz-flow.js';
import { answerList, hasAnswer, answerLabel, isCorrect, parseQuizText, appendQuestions, MAX_LESSON_QUESTIONS } from './question-utils.js';
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  book: '<path d="M12 7C8 4 5 4 2 5v14c4-1 7 0 10 2 3-2 6-3 10-2V5c-3-1-6-1-10 2Zm0 0v14"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4M18 4h4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  trophy: '<path d="M8 3h8v7a4 4 0 0 1-8 0V3ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v6m-5 1h10"/>',
  file: '<path d="M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8m-8 4h8"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M3 16v5h18v-5"/>',
  logout: '<path d="M9 4H3v16h6m5-13 5 5-5 5m-7-5h12"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  leaf: '<path d="M20 3C7 2 1 8 6 16s15 1 14-13ZM5 21l10-11"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.book}</svg>`;
const state = { user: null, library: { semesters: [], subjects: [], lessons: [] }, history: [], page: 'library', semester: 'all', subject: 'all', search: '', authMode: 'login', showAll: false, shown: new Set(), aiEnabled: false, draft: null, lesson: null, attempt: null, index: 0, choice: null, adminUsers: [], adminStats: null };
let toastTimer, modalFocus;
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 5000); }
async function api(path, options = {}) {
  const token = sessionStorage.getItem('qh_token');
  const headers = {
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...options.headers
  };
  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && state.user) {
      sessionStorage.removeItem('qh_token');
      state.user = null;
      render();
    }
    throw new Error(data.error || 'Không thể xử lý yêu cầu.');
  }
  return data;
}
async function refresh() { const [library, history, exams] = await Promise.all([api('/library'), api('/attempts'), api('/exams')]); state.library = library; state.history = [...history, ...exams].sort((a,b)=>b.started_at.localeCompare(a.started_at)).slice(0,200); }
const fmtDate = value => new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
const button = (action, label, type = 'secondary', extra = '') => `<button class="btn ${type}" data-action="${action}" ${extra}>${label}</button>`;
function logo() { return `<div class="logo"><span class="logo-mark">${icon('book')}</span>Quiz<span>Hub</span><span class="logo-dot"></span></div>`; }
function renderAuth() {
  unmountStudyNavigation();
  const register = state.authMode === 'register';
  const rememberedEmail = localStorage.getItem('qh_remembered_email') || '';
  const rememberedName = localStorage.getItem('qh_remembered_name') || '';
  const isRemembered = Boolean(rememberedEmail);
  $('#app').innerHTML = `<main class="auth"><section class="auth-story">${logo()}<div class="auth-story-body"><span class="eyebrow light">MỖI NGÀY, MỘT CHÚT TIẾN BỘ</span><h1>Học có cách.<br>Nhớ thật lâu.</h1><p>Biến bài học thành những câu hỏi nhỏ.<br>Ôn tập chủ động, tự tin hơn mỗi ngày.</p><div class="study-art"><div class="art-card art-back"><span>HÔM NAY BẠN ĐÃ HỌC ĐƯỢC GÌ?</span><div class="art-lines"></div></div><div class="art-card art-front"><div class="art-label">${icon('spark')} Một câu hỏi nhỏ</div><h3>Cách tốt nhất để ghi nhớ<br>là chủ động nhớ lại.</h3><div class="art-answer">${icon('check')} Bắt đầu với một bài quiz</div></div><div class="art-badge">${icon('leaf')} Học theo nhịp của bạn</div><span class="orbit one">✦</span><span class="orbit two">✧</span></div></div><div class="auth-footer">Không gian riêng cho hành trình học tập của bạn.</div></section><section class="auth-panel"><div class="auth-form-wrap"><span class="pill">${icon('book')} KHÔNG GIAN HỌC TẬP</span><h2>${register ? 'Bắt đầu hành trình mới' : (rememberedName ? `Chào mừng trở lại, ${esc(rememberedName)} 👋` : 'Chào bạn trở lại 👋')}</h2><p class="muted">${register ? 'Tạo tài khoản để lưu bài học và theo dõi tiến bộ.' : 'Một chút tập trung hôm nay, thêm tự tin ngày mai.'}</p><div class="segmented"><button data-action="auth-mode" data-mode="login" class="${!register ? 'active' : ''}">Đăng nhập</button><button data-action="auth-mode" data-mode="register" class="${register ? 'active' : ''}">Tạo tài khoản</button></div><form id="auth-form">${register ? '<label>Họ và tên<input name="name" placeholder="Bạn muốn được gọi là gì?" required maxlength="80" autocomplete="name"></label>' : ''}<label>Email / Tên đăng nhập<input type="email" name="email" value="${esc(rememberedEmail)}" placeholder="ban@example.com" required maxlength="254" autocomplete="email"></label><label>Mật khẩu<input type="password" name="password" placeholder="${register ? 'Ít nhất 8 ký tự' : 'Nhập mật khẩu của bạn'}" required minlength="8" maxlength="128" autocomplete="${register ? 'new-password' : 'current-password'}" ${rememberedEmail && !register ? 'autofocus' : ''}></label>${!register ? `<div class="auth-remember-row"><label class="remember-checkbox"><input type="checkbox" id="remember-me" ${isRemembered ? 'checked' : ''}><span>Ghi nhớ tên đăng nhập</span></label>${rememberedName ? `<span class="remembered-user-badge">${icon('check')} Đã ghi nhớ</span>` : ''}</div>` : ''}<div id="auth-error" class="form-error" role="alert"></div><button class="btn primary full" type="submit">${register ? 'Tạo tài khoản' : 'Vào không gian học tập'} ${icon('arrow')}</button></form><p class="auth-note">${icon('check')} Bài học và lịch sử được lưu vào tài khoản của bạn.</p></div><small class="auth-bottom">QUIZ HUB · HỌC MỘT CHÚT, TIẾN MỘT BƯỚC</small></section></main>`;
}
function shell(content) {
  unmountStudyNavigation();
  const { semesters } = state.library;
  const isAdmin = state.user?.role === 'admin';
  $('#app').innerHTML = `<div class="app-shell"><aside class="sidebar">${logo()}<div class="workspace-tag"><span class="avatar mini">${esc(state.user.name.charAt(0).toUpperCase())}</span><div>${esc(isAdmin ? 'Quản trị viên' : 'Không gian cá nhân')}<small>${isAdmin ? 'Toàn quyền hệ thống' : 'Cùng học tốt hơn mỗi ngày'}</small></div></div><span class="nav-caption">KHÔNG GIAN HỌC TẬP</span><nav><button data-action="nav-library" class="nav-item ${state.page !== 'history' && state.page !== 'admin' ? 'active' : ''}">${icon('grid')} Thư viện của tôi <span class="nav-count">${state.library.lessons.length}</span></button><button data-action="nav-history" class="nav-item ${state.page === 'history' ? 'active' : ''}">${icon('clock')} Lịch sử luyện tập</button>${isAdmin ? `<button data-action="nav-admin" class="nav-item ${state.page === 'admin' ? 'active' : ''}">${icon('users')} Quản trị hệ thống</button>` : ''}</nav><div class="nav-caption semester-caption">HỌC KỲ <button class="icon-btn" data-action="add-semester" aria-label="Thêm học kỳ">${icon('plus')}</button></div><div class="semester-nav">${semesters.map(s => `<button class="nav-item ${state.semester === s.id ? 'selected' : ''}" data-action="select-semester" data-id="${s.id}"><span class="semester-dot"></span>${esc(s.name)}</button>`).join('') || '<p class="sidebar-empty">Học kỳ đầu tiên đang chờ bạn.</p>'}<button class="nav-item subtle" data-action="add-semester">${icon('plus')} Thêm học kỳ</button></div><div class="sidebar-tip"><span class="tip-icon">${icon('spark')}</span><strong>Bài học → Quiz, thật nhanh</strong><p>Tải ảnh tài liệu, để AI giúp bạn chuẩn bị câu hỏi ôn tập.</p><button data-action="new-ai">Thử tạo bằng AI ${icon('arrow')}</button></div><div class="user-block"><span class="avatar">${esc(state.user.name.charAt(0).toUpperCase())}</span><div><strong>${esc(state.user.name)}</strong><small>${isAdmin ? '👑 Quản trị viên' : 'Học viên'}</small></div><button class="icon-btn" data-action="logout" title="Đăng xuất" aria-label="Đăng xuất">${icon('logout')}</button></div></aside><div class="main-wrap"><header class="topbar"><div class="breadcrumb">Không gian của tôi ${icon('arrow')} <strong>${state.page === 'admin' ? 'Quản trị hệ thống' : state.page === 'history' ? 'Lịch sử luyện tập' : state.page === 'editor' ? 'Tạo & chỉnh sửa bài' : state.page === 'study' ? 'Học bài' : state.page === 'exam' ? 'Thi thử' : state.page === 'quiz' ? 'Luyện tập' : 'Thư viện'}</strong></div><div class="topbar-right"><span class="saved-dot"></span> Lưu trên tài khoản <span class="avatar small">${esc(state.user.name.charAt(0).toUpperCase())}</span></div></header><main id="main-content">${content}</main><footer class="main-footer">Học một chút, tiến một bước. <span>Made for your next “À, hiểu rồi!”</span></footer></div></div>`;
}
async function loadAdminData() {
  if (state.user?.role !== 'admin') return;
  const [stats, usersRes] = await Promise.all([api('/admin/stats'), api('/admin/users')]);
  state.adminStats = stats;
  state.adminUsers = usersRes.users;
}
function renderAdmin() {
  const stats = state.adminStats || { totalUsers: 0, totalLessons: 0, totalAttempts: 0, totalExams: 0 };
  const users = state.adminUsers || [];
  shell(`<section class="page-heading"><div><span class="eyebrow">QUẢN TRỊ VIÊN HỆ THỐNG</span><h1>Quản trị người dùng & Phân quyền<span class="heading-dot">.</span></h1><p>Quản lý tài khoản, thay đổi quyền hạn và theo dõi hoạt động toàn hệ thống.</p></div><button class="btn secondary" data-action="refresh-admin">${icon('spark')} Làm mới</button></section><section class="stats"><div class="stat"><span class="stat-icon lavender">${icon('users')}</span><div><span>Người dùng</span><strong>${stats.totalUsers}<small>tài khoản</small></strong></div></div><div class="stat"><span class="stat-icon peach">${icon('book')}</span><div><span>Tổng bài học</span><strong>${stats.totalLessons}<small>bài học</small></strong></div></div><div class="stat"><span class="stat-icon green">${icon('trophy')}</span><div><span>Lượt luyện tập</span><strong>${stats.totalAttempts}<small>lượt quiz</small></strong></div></div><div class="stat"><span class="stat-icon blue">${icon('clock')}</span><div><span>Kỳ thi thử</span><strong>${stats.totalExams}<small>kỳ thi</small></strong></div></div></section><section class="panel"><div class="section-title"><div><h2>Danh sách tài khoản (${users.length})</h2><p>Phân quyền vai trò người dùng (Quản trị viên / Học viên) và quản lý tài khoản người dùng.</p></div></div><div class="history-table"><table><thead><tr><th>Người dùng</th><th>Email</th><th>Vai trò</th><th>Ngày tham gia</th><th>Thao tác</th></tr></thead><tbody>${users.map(u => `<tr><td><div style="display:flex;align-items:center;gap:10px;"><span class="avatar mini">${esc(u.name.charAt(0).toUpperCase())}</span><strong>${esc(u.name)}</strong>${u.id === state.user.id ? '<span class="status-badge" style="font-size:10px;">Bạn</span>' : ''}</div></td><td>${esc(u.email)}</td><td><span class="status-badge ${u.role === 'admin' ? 'done' : ''}" style="${u.role === 'admin' ? 'background:#fef3c7;color:#92400e;' : ''}">${u.role === 'admin' ? '👑 Quản trị viên' : 'Học viên'}</span></td><td>${fmtDate(u.created_at)}</td><td><div class="inline-actions">${u.id !== state.user.id ? `<button class="btn text-btn" data-action="toggle-role" data-id="${u.id}" data-role="${u.role === 'admin' ? 'user' : 'admin'}">${u.role === 'admin' ? 'Hạ xuống Học viên' : 'Cấp quyền Quản trị'}</button><button class="icon-btn danger-text" data-action="delete-user" data-id="${u.id}" data-name="${esc(u.name)}" title="Xóa tài khoản" aria-label="Xóa ${esc(u.name)}">${icon('trash')}</button>` : '<span class="muted" style="font-size:12px;">Đang đăng nhập</span>'}</div></td></tr>`).join('')}</tbody></table></div></section>`);
}
function render() { if (!state.user) return renderAuth(); if (state.page === 'admin' && state.user.role === 'admin') return renderAdmin(); if (state.page === 'exam') return renderExam(); if (state.page === 'editor') return renderEditor(); if (state.page === 'study') return renderStudy(); if (state.page === 'quiz') return renderQuiz(); if (state.page === 'history') return renderHistory(); renderLibrary(); }
function lessonSubject(l) { return state.library.subjects.find(s => s.id === l.subject_id); }
function filteredLessons() { return state.library.lessons.filter(l => (state.semester === 'all' || lessonSubject(l)?.semester_id === state.semester) && (state.subject === 'all' || l.subject_id === state.subject) && `${l.name} ${lessonSubject(l)?.name} ${l.description}`.toLowerCase().includes(state.search.toLowerCase())); }
function lessonCards() {
  const lessons = filteredLessons();
  if (!lessons.length) return `<div class="empty-state"><div class="empty-icon">${icon('book')}</div><h3>${state.search ? 'Chưa tìm thấy bài học' : 'Một hành trình mới bắt đầu từ đây'}</h3><p>${state.search ? 'Thử một từ khóa khác hoặc chọn tất cả môn học.' : 'Thêm học kỳ, chọn môn và tạo bài học đầu tiên của bạn.'}</p>${!state.search ? button(state.library.subjects.length ? 'new-lesson' : state.library.semesters.length ? 'add-subject' : 'add-semester', `${icon('plus')} ${state.library.subjects.length ? 'Tạo bài học đầu tiên' : state.library.semesters.length ? 'Thêm môn học' : 'Thêm học kỳ đầu tiên'}`, 'primary') : ''}${!state.library.lessons.length && !state.search ? '<button class="text-btn" data-action="sample">Hoặc khám phá với một bài mẫu →</button>' : ''}</div>`;
  return `<div class="lesson-grid">${lessons.map((l, idx) => { const subject = lessonSubject(l); const completed = state.history.filter(a => a.lesson_id === l.id && a.finished_at); const best = completed.length ? Math.max(...completed.map(a => Math.round(a.score / a.total * 100))) : null; const inProgress = state.history.find(a => a.lesson_id === l.id && !a.finished_at); return `<article class="lesson-card"><div class="card-top"><span class="course-icon tone-${idx % 4}">${icon(['book', 'file', 'leaf', 'spark'][idx % 4])}</span><span class="subject-label">${esc(subject?.name)}</span><button class="icon-btn" data-action="edit-lesson" data-id="${l.id}" title="Chỉnh sửa bài" aria-label="Chỉnh sửa ${esc(l.name)}">${icon('edit')}</button></div><h3>${esc(l.name)}</h3><p class="card-description">${esc(l.description || 'Sẵn sàng cho một buổi học tập trung?')}</p><div class="card-meta"><span>${icon('file')} ${l.count} câu hỏi</span><span>${fmtDate(l.updated_at)}</span></div><div class="card-progress"><span>${best === null ? 'Chưa luyện tập' : `Kết quả tốt nhất <b>${best}%</b>`}</span>${inProgress ? '<span class="in-progress">Đang làm</span>' : ''}</div><div class="card-actions">${button('study', `${icon('book')} Học bài`, 'secondary', `data-id="${l.id}"`)}${button(inProgress ? 'resume' : 'quiz', `${inProgress ? 'Tiếp tục' : 'Làm quiz'} ${icon('arrow')}`, 'soft', `data-id="${inProgress?.id || l.id}"`)}</div></article>`; }).join('')}</div>`;
}
function renderLibrary() {
  const { semesters, subjects, lessons } = state.library;
  const current = semesters.find(s => s.id === state.semester);
  const visibleSubjects = subjects.filter(s => state.semester === 'all' || s.semester_id === state.semester);
  const completed = state.history.filter(a => a.finished_at);
  const correct = completed.reduce((n, a) => n + a.score, 0), total = completed.reduce((n, a) => n + a.total, 0);
  shell(`<section class="page-heading"><div><span class="eyebrow">MỘT NGÀY TỐT ĐỂ HỌC ĐIỀU MỚI</span><h1>Thư viện của tôi<span class="heading-dot">.</span></h1><p>Sắp xếp kiến thức. Luyện tập mỗi ngày. Nhìn thấy tiến bộ.</p></div><div class="inline-actions">${button('exam-setup', `${icon('clock')} Thi thử theo môn`, 'secondary')}${button('new-lesson', `${icon('plus')} Tạo bài học`, 'primary')}</div></section><section class="welcome-banner"><div><span class="pill banner-pill">${icon('spark')} HỌC THÔNG MINH HƠN</span><h2>Từ tài liệu đến quiz,<br>chỉ trong vài bước.</h2><p>Đưa ảnh bài học cho AI. Dành thời gian cho việc hiểu bài.</p><button class="btn dark" data-action="new-ai">${icon('spark')} Tạo quiz bằng AI ${icon('arrow')}</button></div><div class="banner-art" aria-hidden="true"><div class="mini-paper paper-one"><div class="paper-label">GHI CHÚ CỦA BẠN</div><div class="paper-line long"></div><div class="paper-line"></div><div class="paper-line long"></div><div class="paper-highlight"></div><div class="paper-line"></div></div><div class="art-connector">✦</div><div class="mini-paper paper-two"><span class="paper-label">SẴN SÀNG ÔN TẬP</span><h4>Một câu hỏi,<br>thêm một lần nhớ.</h4><div class="paper-option">A <span></span></div><div class="paper-option picked">B <span></span> ✓</div><div class="paper-option">C <span></span></div></div><span class="banner-spark">✧</span></div></section><section class="stats"><div class="stat"><span class="stat-icon lavender">${icon('book')}</span><div><span>Tổng bài học</span><strong>${lessons.length}<small>bài học</small></strong></div></div><div class="stat"><span class="stat-icon peach">${icon('file')}</span><div><span>Ngân hàng câu hỏi</span><strong>${lessons.reduce((n, l) => n + l.count, 0)}<small>câu hỏi</small></strong></div></div><div class="stat"><span class="stat-icon green">${icon('trophy')}</span><div><span>Đã hoàn thành</span><strong>${completed.length}<small>lượt quiz</small></strong></div></div><div class="stat"><span class="stat-icon blue">${icon('check')}</span><div><span>Tỷ lệ trả lời đúng</span><strong>${total ? Math.round(correct / total * 100) + '%' : '—'}<small>${total ? 'tiếp tục cố gắng!' : 'bắt đầu luyện tập'}</small></strong></div></div></section><section class="library-section"><div class="section-title"><div><h2>${esc(current?.name || 'Tất cả bài học')} <span class="count-badge">${filteredLessons().length}</span></h2><p>Một góc nhỏ cho tất cả kiến thức của bạn.</p></div><div class="inline-actions">${current ? `<button class="icon-btn" data-action="rename-semester" data-id="${current.id}" title="Đổi tên học kỳ" aria-label="Đổi tên học kỳ">${icon('edit')}</button><button class="icon-btn" data-action="delete-semester" data-id="${current.id}" title="Xóa học kỳ" aria-label="Xóa học kỳ">${icon('trash')}</button>` : ''}${state.subject !== 'all' ? button('exam-setup', `${icon('clock')} Thi thử môn này`, 'soft', `data-id="${state.subject}"`) : ''}${button('add-subject', `${icon('plus')} Thêm môn`, 'secondary')}</div></div><div class="library-toolbar"><div class="subject-tabs"><button class="chip ${state.subject === 'all' ? 'active' : ''}" data-action="filter-subject" data-id="all">Tất cả môn</button>${visibleSubjects.map(s => `<button class="chip ${state.subject === s.id ? 'active' : ''}" data-action="filter-subject" data-id="${s.id}">${esc(s.name)}</button>`).join('')}</div><label class="search-box">${icon('search')}<input id="search" placeholder="Tìm bài học…" value="${esc(state.search)}" aria-label="Tìm bài học"></label></div>${state.subject !== 'all' ? `<div class="subject-management"><span>${esc(subjects.find(s => s.id === state.subject)?.name)}</span><button class="text-btn" data-action="rename-subject" data-id="${state.subject}">Đổi tên</button><button class="text-btn danger-text" data-action="delete-subject" data-id="${state.subject}">Xóa môn</button></div>` : ''}<div id="lesson-results">${lessonCards()}</div></section>`);
}
function openModal(title, body) { modalFocus = document.activeElement; $('#modal-root').innerHTML = `<div class="modal-overlay"><section role="dialog" aria-modal="true" aria-labelledby="modal-title" class="modal"><div class="modal-heading"><h2 id="modal-title">${esc(title)}</h2><button class="icon-btn" data-action="close-modal" aria-label="Đóng">${icon('close')}</button></div>${body}</section></div>`; $('#modal-root input, #modal-root select, #modal-root button')?.focus(); }
function closeModal() { $('#modal-root').innerHTML = ''; modalFocus?.focus(); }
function nameModal(kind, id) {
  if (state.page === 'editor') captureDraft();
  const isSubject = kind === 'subject', items = isSubject ? state.library.subjects : state.library.semesters, existing = items.find(x => x.id === id);
  if (isSubject && !state.library.semesters.length) { toast('Thêm học kỳ trước để sắp xếp các môn học.'); return nameModal('semester'); }
  openModal(`${existing ? 'Đổi tên' : 'Thêm'} ${isSubject ? 'môn học' : 'học kỳ'}`, `<form id="name-form" data-kind="${kind}" data-id="${id || ''}">${isSubject && !id ? `<label>Thuộc học kỳ<select name="semester_id">${state.library.semesters.map(s => `<option value="${s.id}" ${state.semester === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>` : ''}<label>Tên ${isSubject ? 'môn học' : 'học kỳ'}<input name="name" value="${esc(existing?.name || '')}" placeholder="${isSubject ? 'Ví dụ: Sinh học đại cương' : 'Ví dụ: Học kỳ 1 · 2026–2027'}" required maxlength="160"></label><div class="form-error" id="modal-error" role="alert"></div><div class="modal-actions">${button('close-modal', 'Hủy')}<button class="btn primary" type="submit">${existing ? 'Lưu thay đổi' : 'Thêm mới'}</button></div></form>`);
}
function newDraft(ai = false) {
  if (!state.library.subjects.length) { toast('Bạn cần thêm học kỳ và môn học trước khi tạo bài.'); return nameModal(state.library.semesters.length ? 'subject' : 'semester'); }
  state.draft = { name: '', description: '', subject_id: state.subject !== 'all' ? state.subject : state.library.subjects.find(s => state.semester === 'all' || s.semester_id === state.semester)?.id || state.library.subjects[0].id, questions: ai ? [] : [blankQuestion()], tab: ai ? 'ai' : 'manual', prompt: '', sourceText: '', count: 10, files: [], warnings: [] };
  state.page = 'editor'; render();
}
const blankQuestion = () => ({ text: '', options: ['', '', '', ''], answer: 0, explanation: '' });
function captureDraft() {
  if (!$('#lesson-form')) return;
  const d = state.draft;
  d.name = $('#lesson-name').value; d.description = $('#lesson-description').value; d.subject_id = $('#lesson-subject').value;
  if ($('#import-source')) d.importText = $('#import-source').value;
  if ($('#ai-prompt')) { d.prompt = $('#ai-prompt').value; d.sourceText = $('#ai-source-text').value; d.count = $('#ai-count').value; }
  document.querySelectorAll('.question-editor').forEach((el, i) => { d.questions[i] = { text: el.querySelector('[data-field="text"]').value, options: [...el.querySelectorAll('[data-field="option"]')].map(x => x.value), answer: [...el.querySelectorAll('input[type=checkbox]:checked')].map(x => Number(x.value)), explanation: el.querySelector('[data-field="explanation"]').value }; });
}
function renderEditor() {
  const d = state.draft;
  shell(`<div class="back-row">${button('leave-editor', `${icon('back')} Thư viện`, 'text-btn')}<span>${d.id ? 'CHỈNH SỬA BÀI HỌC' : 'THÊM MỘT CHÚT KIẾN THỨC'}</span></div><section class="page-heading compact"><div><h1>${d.id ? 'Chỉnh sửa bài học' : 'Tạo bài học mới'}<span class="heading-dot">.</span></h1><p>Tự soạn câu hỏi hoặc để AI giúp bạn bắt đầu.</p></div><div class="inline-actions">${d.id ? button('delete-lesson', icon('trash'), 'secondary danger-text', `data-id="${d.id}" aria-label="Xóa bài học"`) : ''}${button('save-lesson', `${icon('check')} Lưu bài học`, 'primary')}</div></section><div id="lesson-form"><section class="panel lesson-info"><h3>Thông tin bài học</h3><div class="form-grid"><label>Tên bài học<input id="lesson-name" value="${esc(d.name)}" placeholder="Ví dụ: Chương 1 · Tế bào và sự sống" maxlength="160" required></label><label>Môn học<select id="lesson-subject">${state.library.subjects.map(s => `<option value="${s.id}" ${s.id === d.subject_id ? 'selected' : ''}>${esc(state.library.semesters.find(t => t.id === s.semester_id)?.name)} / ${esc(s.name)}</option>`).join('')}</select></label></div><label>Mô tả ngắn <span class="muted">(không bắt buộc)</span><input id="lesson-description" value="${esc(d.description)}" placeholder="Nội dung bạn muốn ghi nhớ trong bài này…" maxlength="2000"></label></section><div class="editor-tabs segmented"><button data-action="editor-tab" data-tab="manual" class="${d.tab === 'manual' ? 'active' : ''}">${icon('edit')} Tự soạn câu hỏi</button><button data-action="editor-tab" data-tab="ai" class="${d.tab === 'ai' ? 'active' : ''}">${icon('spark')} Tạo bằng AI</button><button data-action="editor-tab" data-tab="import" class="${d.tab === 'import' ? 'active' : ''}">${icon('file')} Nhập văn bản</button></div>${d.tab === 'import' ? `<section class="panel"><h3>Nhập đề có sẵn · Không dùng AI</h3><p class="help-text">Tách câu hỏi, lựa chọn và đáp án ngay trên trình duyệt. Không cần API key, không gửi văn bản đến dịch vụ AI. Hỗ trợ Answer: B, Answer: AB hoặc Đáp án: A, C.</p><label>Văn bản đề<textarea id="import-source" rows="14" maxlength="200000" placeholder="Question 1: 2 + 3 = ?&#10;A. 4&#10;B. 5&#10;Answer: B">${esc(d.importText || '')}</textarea></label>${button('import-text', `${icon('file')} Tách câu hỏi (không AI)`, 'primary')}<p class="help-text">Mỗi lần dán tối đa 100 câu; mỗi bài tối đa 500 câu. Nhập xong có thể dán tiếp đợt mới vào cùng bài. Câu chưa có đáp án rõ ràng sẽ được giữ lại để bạn chọn trước khi lưu. Câu nhiều đáp án chỉ đúng khi chọn đủ và không chọn thừa.</p>${d.importWarnings?.length ? `<div class="notice">${d.importWarnings.map(esc).join('<br>')}</div>` : ''}</section>` : ''}${d.tab === 'ai' ? `<section class="panel ai-panel"><div class="ai-heading"><span class="stat-icon lavender">${icon('spark')}</span><div><h3>Trợ lý soạn quiz của bạn</h3><p>Dán văn bản hoặc tải ảnh, rồi kiểm tra câu hỏi và đáp án trước khi lưu.</p></div></div>${!state.aiEnabled ? '<div class="notice">AI chưa được bật. Thêm OPENAI_API_KEY vào file .env của server và khởi động lại để sử dụng.</div>' : ''}<label class="upload-zone" id="drop-zone"><input type="file" id="ai-files" accept=".png,.jpg,.jpeg,.webp,.zip" multiple ${d.busy ? 'disabled' : ''}>${icon('upload')}<strong>Chọn ảnh hoặc kéo thả tệp vào đây</strong><span>JPG, PNG, WebP hoặc ZIP chứa ảnh · Tối đa 20 ảnh</span><small>10 MB/tệp · 30 MB tổng dung lượng sau giải nén</small></label><div class="file-list">${(d.files || []).map((f, i) => `<span class="file-chip">${icon('file')} ${esc(f.name)} <button data-action="remove-file" data-index="${i}" aria-label="Bỏ tệp ${esc(f.name)}">×</button></span>`).join('')}</div><label>Văn bản nguồn<textarea id="ai-source-text" rows="10" maxlength="60000" placeholder="Câu 1: Thủ đô của Việt Nam là gì?&#10;A. Hà Nội&#10;B. Huế&#10;C. Đà Nẵng&#10;D. Cần Thơ&#10;&#10;Câu 2: 2 + 3 bằng bao nhiêu?&#10;A. 4&#10;B. 5&#10;C. 6&#10;D. 7">${esc(d.sourceText || '')}</textarea><span class="help-text">Dán đề có sẵn hoặc đoạn kiến thức cần tạo câu hỏi. Tối đa 60.000 ký tự; mỗi bài tối đa 500 câu. Đề có A–D sẽ giữ đủ 4 lựa chọn. Nếu chưa có đáp án, AI sẽ đề xuất để bạn kiểm tra.</span></label><label>Yêu cầu cho AI (không bắt buộc)<textarea id="ai-prompt" rows="4" maxlength="10000" placeholder="Ví dụ: Trích xuất câu hỏi từ ảnh, giữ nguyên các đáp án A–D. Giải thích ngắn gọn vì sao đáp án đúng.">${esc(d.prompt)}</textarea></label><div class="ai-bottom"><label>Số câu khi tạo từ kiến thức<input id="ai-count" type="number" min="1" max="50" value="${esc(d.count || 10)}"></label>${button('generate-ai', `${icon('spark')} ${d.busy ? 'AI đang đọc tài liệu…' : 'Tạo câu hỏi'}`, 'primary', !state.aiEnabled || d.busy ? 'disabled' : '')}</div><p class="help-text">Nguồn có sẵn câu hỏi: giữ nguyên số câu và các lựa chọn, không áp dụng số câu khi tạo mới. Văn bản, ảnh và yêu cầu sẽ được gửi đến OpenAI khi bạn bấm tạo. Kết quả chỉ được lưu thành bài sau khi bạn kiểm tra và bấm Lưu bài học.</p>${d.warnings?.length ? `<div class="notice">${d.warnings.map(esc).join('<br>')}</div>` : ''}</section>` : ''}<div class="section-title question-section-title"><div><h2>${d.tab === 'ai' ? 'Xem lại câu hỏi' : 'Danh sách câu hỏi'} <span class="count-badge">${d.questions.length} / 500</span></h2><p>Đánh dấu tất cả đáp án đúng. Có thể chọn một hoặc nhiều đáp án.</p></div>${button('add-question', `${icon('plus')} Thêm câu`, 'secondary')}</div>${d.questions.map((q, i) => `<section class="panel question-editor" data-index="${i}"><div class="question-editor-head"><span class="eyebrow">CÂU ${String(i + 1).padStart(2, '0')}</span><button class="icon-btn danger-text" data-action="remove-question" data-index="${i}" aria-label="Xóa câu ${i + 1}">${icon('trash')}</button></div>${!answerList(q.answer).length ? `<div class="notice">Chưa xác định đáp án đúng. ${esc(q.sourceAnswer || 'Hãy chọn đáp án trước khi lưu.')}</div>` : ''}<label>Nội dung câu hỏi<textarea data-field="text" rows="2" maxlength="6000" placeholder="Nhập câu hỏi của bạn…">${esc(q.text)}</textarea></label><div class="options-editor">${q.options.map((o, j) => `<div class="option-editor ${hasAnswer(q.answer, j) ? 'correct-option' : ''}"><input type="checkbox" name="answer-${i}" value="${j}" ${hasAnswer(q.answer, j) ? 'checked' : ''} aria-label="Chọn ${String.fromCharCode(65 + j)} là đáp án đúng"><span>${String.fromCharCode(65 + j)}</span><input data-field="option" value="${esc(o)}" maxlength="3000" aria-label="Đáp án ${String.fromCharCode(65 + j)} câu ${i + 1}" placeholder="Nội dung đáp án"><button class="icon-btn" data-action="remove-option" data-index="${i}" data-option="${j}" ${q.options.length <= 2 ? 'disabled' : ''} aria-label="Xóa lựa chọn ${String.fromCharCode(65 + j)}">${icon('close')}</button></div>`).join('')}</div>${button('add-option', `${icon('plus')} Thêm lựa chọn`, 'text-btn', `data-index="${i}" ${q.options.length >= 8 ? 'disabled' : ''}`)}<label class="explanation-label">Giải thích <span class="muted">(không bắt buộc)</span><textarea data-field="explanation" rows="2" maxlength="6000" placeholder="Vì sao đáp án này đúng?">${esc(q.explanation)}</textarea></label></section>`).join('') || '<div class="empty-state small-empty"><h3>Những câu hỏi mới sẽ xuất hiện ở đây</h3><p>Tạo bằng AI hoặc thêm câu hỏi thủ công.</p></div>'}<div class="editor-bottom">${button('add-question', `${icon('plus')} Thêm câu hỏi`, 'secondary')}${button('save-lesson', `${icon('check')} Lưu bài học`, 'primary')}</div></div>`);
}
function renderStudy() {
  const l = state.lesson;
  shell(`<div class="back-row">${button('nav-library', `${icon('back')} Thư viện`, 'text-btn')}<span>${esc(lessonSubject(l)?.name || '')}</span></div><section class="page-heading compact"><div><span class="eyebrow">HỌC THEO NHỊP CỦA BẠN</span><h1>${esc(l.name)}</h1><p>${l.questions.length} câu hỏi · Đọc câu hỏi, tự nhớ lại, rồi kiểm tra đáp án.</p></div>${button('quiz', `Làm quiz ${icon('arrow')}`, 'primary', `data-id="${l.id}"`)}</section><div class="study-toolbar"><div class="mode-label">${icon('book')} Chế độ học</div>${button('toggle-all', `${icon('eye')} ${state.showAll ? 'Ẩn tất cả đáp án' : 'Hiện tất cả đáp án'}`, state.showAll ? 'primary' : 'secondary', `aria-pressed="${state.showAll}"`)}</div><div class="study-list">${l.questions.map((q, i) => { const show = state.showAll || state.shown.has(i); return `<article class="panel study-card"><span class="eyebrow">CÂU ${String(i + 1).padStart(2, '0')}</span><h3 class="question-text">${esc(q.text)}</h3><div class="study-options">${q.options.map((o, j) => `<div class="study-option ${show && hasAnswer(q.answer, j) ? 'correct' : ''}"><span class="letter">${String.fromCharCode(65 + j)}</span><span>${esc(o)}</span>${show && hasAnswer(q.answer, j) ? icon('check') : ''}</div>`).join('')}</div>${show ? `<div class="answer-explanation"><strong>${icon('check')} Đáp án ${answerLabel(q.answer)}</strong>${q.explanation ? `<p>${esc(q.explanation)}</p>` : ''}</div>` : ''}${!state.showAll ? button('toggle-answer', `${icon('eye')} ${show ? 'Ẩn đáp án' : 'Hiện đáp án'}`, 'text-btn', `data-index="${i}" aria-expanded="${show}"`) : ''}</article>`; }).join('')}</div>`);
  mountStudyNavigation(document.querySelector('.study-list'));
}
function renderQuiz() {
  const a = state.attempt, q = a.questions[state.index], choice = a.answers[state.index], answered = choice !== undefined, finished = Boolean(a.finished_at), reviewed = answered || finished;
  shell(`<div class="back-row">${button('nav-library', `${icon('back')} Thư viện`, 'text-btn')}<span>Tiến độ được lưu sau mỗi câu trả lời</span></div><section class="page-heading compact"><div><span class="eyebrow">${finished ? 'MỖI LẦN LUYỆN, THÊM MỘT LẦN NHỚ' : 'TẬP TRUNG VÀO TỪNG CÂU HỎI'}</span><h1>${esc(a.lesson_name)}</h1><p>${finished ? `Hoàn thành ngày ${fmtDate(a.finished_at)} · Xem lại đáp án bên dưới.` : 'Chưa biết đáp án? Bỏ qua và quay lại bất cứ lúc nào.'}</p></div>${finished ? button('quiz', 'Làm lại bài này', 'primary', `data-id="${a.lesson_id}"`) : button('finish-quiz', 'Kết thúc bài', 'secondary')}</section>${finished ? `<section class="result-banner"><span class="result-icon">${icon('trophy')}</span><div><h2>${Math.round(a.score / a.total * 100)}% · ${a.score}/${a.total} câu đúng</h2><p>${a.score === a.total ? 'Thật tốt! Bạn đã nắm vững bài học này.' : 'Mỗi câu chưa đúng là một cơ hội để hiểu thêm.'} ${a.total - Object.keys(a.answers).length ? `Có ${a.total - Object.keys(a.answers).length} câu chưa trả lời.` : ''}</p></div></section>` : ''}<div class="quiz-layout"><section class="panel quiz-question"><div class="quiz-question-top"><span class="eyebrow">CÂU ${String(state.index + 1).padStart(2, '0')} / ${a.total}</span><span class="pill">${reviewed ? answered ? 'Đã trả lời' : 'Đã bỏ qua' : q.multiple ? 'Chọn nhiều đáp án' : 'Một đáp án đúng'}</span></div><h2 class="question-text">${esc(q.text)}</h2><div class="quiz-options">${q.options.map((o, j) => `<button class="quiz-option ${reviewed && hasAnswer(q.answer, j) ? 'correct' : reviewed && hasAnswer(choice, j) ? 'incorrect' : !reviewed && hasAnswer(state.choice, j) ? 'chosen' : ''}" data-action="choose" data-option="${j}" ${reviewed ? 'disabled' : ''} aria-pressed="${hasAnswer(answered ? choice : state.choice, j)}"><span class="letter">${String.fromCharCode(65 + j)}</span><span>${esc(o)}</span>${reviewed && hasAnswer(q.answer, j) ? icon('check') : reviewed && hasAnswer(choice, j) ? icon('close') : ''}</button>`).join('')}</div>${reviewed ? `<div class="answer-explanation ${!isCorrect(choice, q.answer) ? 'wrong-explanation' : ''}"><strong>${icon(isCorrect(choice, q.answer) ? 'check' : 'book')} ${isCorrect(choice, q.answer) ? 'Chính xác!' : answered ? 'Chưa đúng, cùng ghi nhớ nhé.' : 'Bạn đã bỏ qua câu này.'} Đáp án ${answerLabel(q.answer)}.</strong>${q.explanation ? `<p>${esc(q.explanation)}</p>` : ''}</div>` : '<p class="help-text">Chọn đáp án rồi bấm nút bên dưới để kiểm tra. Sau khi xem kết quả, bấm lần nữa để sang câu sau. Chưa chọn thì bấm để bỏ qua.</p>'}<div class="quiz-navigation">${button('previous-question', `${icon('back')} Câu trước`, 'secondary', state.index === 0 ? 'disabled' : '')}<span>${state.index + 1} / ${a.total}</span>${button('next-question', `${nextQuizLabel(a, state.index, state.choice)} ${icon(nextQuizAction(a, state.index, state.choice) === 'check' ? 'check' : 'arrow')}`, 'primary', nextQuizAction(a, state.index, state.choice) === 'done' ? 'disabled' : '')}</div></section><aside class="panel question-map"><h3>Tiến độ luyện tập</h3><div class="progress-label"><span>Đã trả lời</span><strong>${Object.keys(a.answers).length}/${a.total}</strong></div><progress value="${Object.keys(a.answers).length}" max="${a.total}"></progress><div class="question-numbers">${a.questions.map((question, i) => `<button class="question-number ${i === state.index ? 'current' : ''} ${a.answers[i] !== undefined ? isCorrect(a.answers[i], question.answer) ? 'right' : 'wrong' : ''}" data-action="jump-question" data-index="${i}" aria-label="Câu ${i + 1}${a.answers[i] !== undefined ? ', đã trả lời' : ', chưa trả lời'}" ${i === state.index ? 'aria-current="step"' : ''}>${i + 1}</button>`).join('')}</div><div class="map-legend"><span><i class="legend-dot right"></i> Đúng</span><span><i class="legend-dot wrong"></i> Chưa đúng</span><span><i class="legend-dot"></i> Chưa làm</span></div><div class="map-tip">${icon('leaf')} Không cần vội. Hiểu bài quan trọng hơn tốc độ.</div></aside></div>`);
}
function renderHistory() {
  shell(`<section class="page-heading"><div><span class="eyebrow">NHÌN LẠI ĐỂ TIẾN XA HƠN</span><h1>Lịch sử luyện tập<span class="heading-dot">.</span></h1><p>Tiếp tục bài đang làm hoặc xem lại những gì bạn đã học.</p></div>${button('nav-library', `${icon('book')} Đến thư viện`, 'primary')}</section><section class="panel history-panel">${state.history.length ? `<div class="history-table"><table><thead><tr><th>Bài học</th><th>Ngày luyện tập</th><th>Kết quả</th><th>Trạng thái</th><th></th></tr></thead><tbody>${state.history.map(a => `<tr><td><strong>${esc(a.lesson_name)}</strong><small>${a.total} câu hỏi</small></td><td>${fmtDate(a.started_at)}</td><td>${a.finished_at ? `<strong>${a.score}/${a.total}</strong> <span class="muted">(${Math.round(a.score / a.total * 100)}%)</span>` : `${a.answered}/${a.total} đã làm`}</td><td><span class="status-badge ${a.finished_at ? 'done' : ''}">${a.finished_at ? 'Hoàn thành' : 'Đang làm'}</span></td><td>${button(a.mode === 'exam' ? 'resume-exam' : 'resume', `${a.finished_at ? 'Xem lại' : 'Tiếp tục'} ${icon('arrow')}`, 'text-btn', `data-id="${a.id}"`)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state"><div class="empty-icon">${icon('clock')}</div><h3>Hành trình của bạn chưa có lượt quiz nào</h3><p>Hoàn thành bài quiz đầu tiên để nhìn thấy tiến bộ ở đây.</p>${button('nav-library', 'Khám phá thư viện', 'primary')}</div>`}</section><p class="help-text">Hiển thị tối đa 200 lượt gần nhất. Các lượt làm được giữ nguyên câu hỏi tại thời điểm bắt đầu.</p>`);
}
async function openAttempt(id) { state.attempt = await api(`/attempts/${id}`); state.index = state.attempt.finished_at ? 0 : Math.max(0, state.attempt.questions.findIndex((q, i) => state.attempt.answers[i] === undefined)); state.choice = null; state.page = 'quiz'; render(); window.scrollTo(0, 0); }
function confirmModal(title, message, action, id = '') { openModal(title, `<p class="confirm-copy">${esc(message)}</p><div class="modal-actions">${button('close-modal', 'Hủy')}${button(action, 'Xác nhận', 'primary', `data-id="${id}"`)}</div>`); }
async function handleAction(el) {
  const action = el.dataset.action, id = el.dataset.id, index = Number(el.dataset.index), option = Number(el.dataset.option);
  switch (action) {
    case 'auth-mode': state.authMode = el.dataset.mode; render(); break;
    case 'logout': if (state.draft && state.page === 'editor') return confirmModal('Đăng xuất?', 'Các thay đổi chưa lưu sẽ bị mất.', 'confirm-logout'); return handleAction({ dataset: { action: 'confirm-logout' } });
    case 'confirm-logout':
      try { await api('/auth/logout', { method: 'POST' }); } catch {}
      sessionStorage.removeItem('qh_token');
      closeModal();
      state.user = null;
      state.draft = null;
      state.lesson = null;
      state.attempt = null;
      state.semester = 'all';
      state.subject = 'all';
      render();
      break;
    case 'nav-admin':
      if (state.user?.role !== 'admin') return;
      if (state.page === 'editor') { captureDraft(); state.pendingNavigation = { action }; return confirmModal('Rời trang soạn bài?', 'Các thay đổi chưa lưu sẽ bị mất.', 'confirm-leave'); }
      await loadAdminData();
      state.page = 'admin';
      render();
      break;
    case 'refresh-admin':
      await loadAdminData();
      render();
      toast('Đã cập nhật dữ liệu.');
      break;
    case 'toggle-role': {
      const targetRole = el.dataset.role;
      await api(`/admin/users/${id}/role`, { method: 'PATCH', body: { role: targetRole } });
      await loadAdminData();
      render();
      toast('Đã cập nhật vai trò người dùng.');
      break;
    }
    case 'delete-user': {
      const userName = el.dataset.name || 'người dùng';
      confirmModal('Xóa tài khoản?', `Bạn có chắc muốn xóa tài khoản "${userName}" và toàn bộ dữ liệu không?`, 'confirm-delete-user', id);
      break;
    }
    case 'confirm-delete-user': {
      await api(`/admin/users/${id}`, { method: 'DELETE' });
      closeModal();
      await loadAdminData();
      render();
      toast('Đã xóa tài khoản.');
      break;
    }
    case 'nav-library': case 'nav-history': case 'select-semester':
      if (state.page === 'editor') { captureDraft(); state.pendingNavigation = { action, id }; return confirmModal('Rời trang soạn bài?', 'Các thay đổi chưa lưu sẽ bị mất. Bạn có thể hủy để lưu bài trước.', 'confirm-leave'); }
      state.page = action === 'nav-history' ? 'history' : 'library'; if (action === 'nav-library') { state.semester = 'all'; state.subject = 'all'; } if (action === 'select-semester') { state.semester = id; state.subject = 'all'; } await refresh(); render(); break;
    case 'leave-editor': state.pendingNavigation = { action: 'nav-library' }; confirmModal('Rời trang soạn bài?', 'Các thay đổi chưa lưu sẽ bị mất.', 'confirm-leave'); break;
    case 'confirm-leave': { closeModal(); state.page = 'library'; state.draft = null; const next = state.pendingNavigation; state.pendingNavigation = null; await handleAction({ dataset: next }); break; }
    case 'add-semester': nameModal('semester'); break;
    case 'add-subject': nameModal('subject'); break;
    case 'rename-semester': nameModal('semester', id); break;
    case 'rename-subject': nameModal('subject', id); break;
    case 'close-modal': closeModal(); break;
    case 'filter-subject': state.subject = id; renderLibrary(); break;
    case 'new-lesson': newDraft(); break;
    case 'new-ai': if (state.page === 'editor') { captureDraft(); state.draft.tab = 'ai'; renderEditor(); } else newDraft(true); break;
    case 'edit-lesson': state.draft = { ...await api(`/lessons/${id}`), tab: 'manual', files: [], warnings: [] }; state.page = 'editor'; render(); break;
    case 'editor-tab': captureDraft(); state.draft.tab = el.dataset.tab; renderEditor(); break;
    case 'add-question': captureDraft(); if (state.draft.questions.length >= MAX_LESSON_QUESTIONS) throw new Error('Tối đa 500 câu mỗi bài.'); state.draft.questions.push(blankQuestion()); renderEditor(); document.querySelector('.question-editor:last-of-type')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); break;
    case 'remove-question': captureDraft(); state.draft.questions.splice(index, 1); renderEditor(); break;
    case 'add-option': captureDraft(); if (state.draft.questions[index].options.length < 8) state.draft.questions[index].options.push(''); renderEditor(); break;
    case 'remove-option': captureDraft(); { const q = state.draft.questions[index]; if (q.options.length <= 2) return; q.options.splice(option, 1); q.answer = answerList(q.answer).filter(a => a !== option).map(a => a > option ? a - 1 : a); renderEditor(); } break;
    case 'remove-file': captureDraft(); state.draft.files.splice(index, 1); renderEditor(); break;
    case 'import-text': {
      captureDraft(); const result = parseQuizText(state.draft.importText || '');
      const existing = state.draft.questions.filter(q => q.text.trim() || q.options.some(o => o.trim()));
      state.draft.questions = appendQuestions(existing, result.questions); state.draft.importWarnings = result.warnings;
      state.draft.importText = ''; renderEditor(); toast('Đã tách ' + result.questions.length + ' câu. Kiểm tra đáp án trước khi lưu.'); break;
    }
    case 'generate-ai': {
      captureDraft(); const draft = state.draft;
      if (draft.busy) return;
      if (!draft.prompt?.trim() && !draft.sourceText?.trim() && !draft.files?.length) throw new Error('Hãy dán văn bản nguồn, nhập yêu cầu hoặc tải ảnh lên.');
      const data = new FormData(); data.append('prompt', draft.prompt || ''); data.append('sourceText', draft.sourceText || ''); data.append('count', draft.count || 10); draft.files.forEach(f => data.append('files', f));
      draft.busy = true; renderEditor();
      try { const result = await api('/ai/generate', { method: 'POST', body: data }); if (state.draft === draft) { if (state.page === 'editor') captureDraft(); draft.questions = appendQuestions(draft.questions, result.questions); draft.warnings = result.warnings; toast(`Đã tạo ${result.questions.length} câu. Hãy kiểm tra đáp án trước khi lưu.`); } }
      finally { draft.busy = false; if (state.page === 'editor' && state.draft === draft) renderEditor(); } break;
    }
    case 'save-lesson': {
      captureDraft(); const d = state.draft; if (d.busy) throw new Error('Đợi AI tạo xong trước khi lưu bài.');
      if (!d.name.trim()) { $('#lesson-name').focus(); throw new Error('Hãy đặt tên bài học.'); }
      if (!d.questions.length) throw new Error('Thêm ít nhất một câu hỏi.');
      const result = await api(d.id ? `/lessons/${d.id}` : '/lessons', { method: d.id ? 'PUT' : 'POST', body: { name: d.name, subject_id: d.subject_id, description: d.description, questions: d.questions } });
      state.subject = d.subject_id; state.semester = state.library.subjects.find(s => s.id === d.subject_id)?.semester_id || 'all'; state.draft = null; state.page = 'library'; await refresh(); render(); toast('Đã lưu bài học. Sẵn sàng ôn tập!'); break;
    }
    case 'delete-semester': case 'delete-subject': case 'delete-lesson': confirmModal('Xóa nội dung này?', 'Bài học bên trong và lịch sử luyện tập liên quan sẽ bị xóa vĩnh viễn.', `confirm-${action}`, id); break;
    case 'confirm-delete-semester': case 'confirm-delete-subject': case 'confirm-delete-lesson': { const resource = action.replace('confirm-delete-', '') + 's'; await api(`/${resource}/${id}`, { method: 'DELETE' }); closeModal(); state.page = 'library'; state.draft = null; state.subject = 'all'; state.semester = 'all'; await refresh(); render(); toast('Đã xóa nội dung.'); break; }
    case 'study': state.lesson = await api(`/lessons/${id}`); state.page = 'study'; state.showAll = false; state.shown = new Set(); render(); window.scrollTo(0, 0); break;
    case 'toggle-all': state.showAll = !state.showAll; state.shown.clear(); renderStudy(); break;
    case 'toggle-answer': if (state.shown.has(index)) state.shown.delete(index); else state.shown.add(index); renderStudy(); break;
    case 'quiz': openModal('Bắt đầu lượt luyện tập', `<p class="confirm-copy">Chọn cách sắp xếp câu hỏi cho lượt làm này.</p><label class="shuffle-setting"><input id="shuffle-questions" type="checkbox">Trộn thứ tự câu hỏi</label><p class="help-text">Không chọn: giữ thứ tự trong bài. Khi trộn, thứ tự được lưu cố định cho lượt này, kể cả khi bạn rời trang rồi tiếp tục.</p><div class="modal-actions">${button('close-modal', 'Hủy')}${button('start-quiz', 'Bắt đầu quiz', 'primary', `data-id="${id}"`)}</div>`); break;
    case 'start-quiz': { const shuffle = $('#shuffle-questions').checked; const a = await api('/attempts', { method: 'POST', body: { lesson_id: id, shuffle } }); closeModal(); await openAttempt(a.id); break; }
    case 'resume': await openAttempt(id); break;
    case 'choose': if (state.attempt.questions[state.index].multiple) { const selected = answerList(state.choice); state.choice = selected.includes(option) ? selected.filter(i => i !== option) : [...selected, option]; } else state.choice = option; renderQuiz(); break;
    case 'previous-question': state.index = Math.max(0, state.index - 1); state.choice = null; renderQuiz(); break;
    case 'next-question': {
      const action = nextQuizAction(state.attempt, state.index, state.choice);
      if (action === 'check') {
        const attemptId = state.attempt.id, currentIndex = state.index;
        const updated = await api(`/attempts/${attemptId}/answer`, { method: 'POST', body: { index: currentIndex, choice: state.choice } });
        if (state.attempt?.id === attemptId) { state.attempt = updated; if (state.index === currentIndex) state.choice = null; if (state.page === 'quiz') renderQuiz(); }
      } else if (action === 'next') { state.index++; state.choice = null; renderQuiz(); }
      else if (action === 'finish') await handleAction({ dataset: { action: 'finish-quiz' } });
      break;
    }
    case 'jump-question': state.index = index; state.choice = null; renderQuiz(); break;
    case 'finish-quiz': { const left = state.attempt.total - Object.keys(state.attempt.answers).length; confirmModal('Kết thúc lượt luyện tập?', left ? `Bạn còn ${left} câu chưa trả lời. Những câu này được tính là chưa đúng. Bạn có thể quay lại làm trước khi kết thúc.` : 'Kết quả sẽ được lưu vào lịch sử để bạn xem lại.', 'confirm-finish'); break; }
    case 'confirm-finish': state.attempt = await api(`/attempts/${state.attempt.id}/finish`, { method: 'POST' }); closeModal(); await refresh(); renderQuiz(); break;
    case 'exam-setup': {
      const subjects = await api('/exam-subjects');
      if (!subjects.some(s=>s.count>0)) throw new Error('Hãy thêm câu hỏi vào môn học trước khi thi thử.');
      const selected = subjects.find(s=>s.id===(id||state.subject)&&s.count>0)||subjects.find(s=>s.count>0);
      state.examSubjects=subjects;
      openModal('Thi thử theo môn', `<label>Môn thi<select id="exam-subject">${subjects.map(s=>`<option value="${s.id}" ${s.id===selected.id?'selected':''} ${s.count?'':'disabled'}>${esc(state.library.semesters.find(t=>t.id===s.semester_id)?.name||'')} / ${esc(s.name)} (${s.count} câu)</option>`).join('')}</select></label><p class="help-text">Lấy ngẫu nhiên từ tất cả bài trong môn, không lặp câu giống hệt nhau.</p><label>Số câu hỏi<input id="exam-count" type="number" min="1" max="${Math.min(500,selected.count)}" value="${Math.min(30,selected.count)}"></label><label>Thời gian thi (phút)<input id="exam-minutes" type="number" min="1" max="180" value="30"></label><p class="help-text">Tối đa 500 câu, 180 phút. Đồng hồ bắt đầu khi bấm Bắt đầu thi. Đáp án được giữ kín đến lúc nộp; hết giờ tự kết thúc.</p><div class="modal-actions">${button('close-modal','Hủy')}${button('start-exam','Bắt đầu thi','primary')}</div>`); break;
    }
    case 'start-exam': {
      const count=Number($('#exam-count').value),minutes=Number($('#exam-minutes').value),subject_id=$('#exam-subject').value;
      const result=await api('/exams',{method:'POST',body:{count,minutes,subject_id}});
      closeModal(); adoptExam(result); state.examIndex=0; state.page='exam'; renderExam(); break;
    }
    case 'resume-exam': adoptExam(await api('/exams/'+id)); state.examIndex=0; state.page='exam'; renderExam(); break;
    case 'exam-choice': case 'exam-clear': {
      if(state.examSaving||state.exam.finished_at)return;
      const examId=state.exam.id, currentIndex=state.examIndex, q=state.exam.questions[currentIndex];
      const selected=answerList(state.exam.answers[currentIndex]);
      const choice=action==='exam-clear'?[]:q.multiple?(selected.includes(option)?selected.filter(i=>i!==option):[...selected,option]):[option];
      state.examSaving=true;renderExam();
      try { const updated=await api('/exams/'+examId+'/answer',{method:'POST',body:{index:currentIndex,choice}}); if(state.exam?.id===examId)adoptExam(updated); }
      finally {state.examSaving=false;if(state.page==='exam')renderExam();} break;
    }
    case 'exam-prev': case 'exam-next': case 'exam-jump': if(state.examSaving)return; state.examIndex=action==='exam-jump'?index:Math.max(0,Math.min(state.exam.total-1,state.examIndex+(action==='exam-next'?1:-1)));renderExam();break;
    case 'exam-submit': if(state.examSaving)return; confirmModal('Nộp bài thi?',`Còn ${state.exam.total-state.exam.answered} câu chưa trả lời. Sau khi nộp bạn sẽ xem điểm và không thể sửa đáp án.`,'confirm-exam-submit',state.exam.id);break;
    case 'confirm-exam-submit': { const result=await api('/exams/'+id+'/finish',{method:'POST'});closeModal();adoptExam(result);state.page='exam';renderExam();break; }
    case 'sample': await createSample(); break;
  }
}
async function createSample() {
  const semester = await api('/semesters', { method: 'POST', body: { name: 'Góc học thử' } });
  const subject = await api('/subjects', { method: 'POST', body: { name: 'Phương pháp học', semester_id: semester.id } });
  await api('/lessons', { method: 'POST', body: { name: 'Học cách học hiệu quả', description: 'Khám phá chủ động nhớ lại và ôn tập ngắt quãng qua 3 câu hỏi nhỏ.', subject_id: subject.id, questions: [
    { text: '“Chủ động nhớ lại” (active recall) là phương pháp nào?', options: ['Đọc lại nguyên văn nhiều lần', 'Tự trả lời câu hỏi mà chưa nhìn tài liệu', 'Chép lại toàn bộ bài học', 'Chỉ tô màu những ý quan trọng'], answer: 1, explanation: 'Tự nhớ lại buộc bạn truy xuất kiến thức và nhận ra phần mình chưa nắm vững.' },
    { text: 'Ôn tập ngắt quãng có nghĩa là gì?', options: ['Học tất cả vào đêm trước kỳ thi', 'Chỉ ôn một lần duy nhất', 'Phân bố các lần ôn qua nhiều thời điểm', 'Học liên tục không nghỉ'], answer: 2, explanation: 'Phân bố các lần ôn giúp duy trì kiến thức lâu dài thay vì chỉ nhớ trong thời gian ngắn.' },
    { text: 'Khi trả lời sai một câu quiz, bước tiếp theo hữu ích nhất là gì?', options: ['Bỏ qua vì không quan trọng', 'Ghi nhớ chữ cái đáp án mà không đọc nội dung', 'Đọc giải thích và thử tự giải thích lại bằng lời của mình', 'Ngừng học chủ đề đó'], answer: 2, explanation: 'Hiểu lý do đúng và sai giúp sửa hiểu nhầm và vận dụng kiến thức vào câu hỏi mới.' }
  ] } });
  state.semester = semester.id; state.subject = 'all'; await refresh(); renderLibrary(); toast('Đã thêm bài mẫu vào thư viện của bạn.');
}
document.addEventListener('click', async event => {
  const el = event.target.closest('[data-action]'); if (!el || el.disabled) return;
  event.preventDefault(); el.disabled = true;
  try { await handleAction(el); } catch (e) { toast(e.message); } finally { if (el.isConnected) el.disabled = false; }
});
document.addEventListener('submit', async event => {
  const form = event.target; if (!['auth-form', 'name-form'].includes(form.id)) return;
  event.preventDefault(); const submit = form.querySelector('[type=submit]'); submit.disabled = true;
  const errorEl = form.querySelector('.form-error'); errorEl.textContent = '';
  try {
    const data = Object.fromEntries(new FormData(form));
    if (form.id === 'auth-form') {
      const result = await api(`/auth/${state.authMode}`, { method: 'POST', body: data });
      if (result.token) sessionStorage.setItem('qh_token', result.token);
      state.user = result.user;
      const rememberCheckbox = form.querySelector('#remember-me');
      if (rememberCheckbox?.checked) {
        localStorage.setItem('qh_remembered_email', data.email);
        localStorage.setItem('qh_remembered_name', result.user.name);
      } else if (state.authMode !== 'register') {
        localStorage.removeItem('qh_remembered_email');
        localStorage.removeItem('qh_remembered_name');
      }
      state.aiEnabled = (await api('/me')).aiEnabled;
      state.page = 'library';
      await refresh();
      render();
    }
    else { const kind = form.dataset.kind, id = form.dataset.id; const result = await api(`/${kind}s${id ? '/' + id : ''}`, { method: id ? 'PATCH' : 'POST', body: data }); closeModal(); await refresh(); if (state.page === 'library') { if (kind === 'semester') { state.semester = id || result.id; state.subject = 'all'; } else { state.subject = id || result.id; if (data.semester_id) state.semester = data.semester_id; } } render(); toast('Đã lưu.'); }
  } catch (e) { errorEl.textContent = e.message; } finally { submit.disabled = false; }
});
document.addEventListener('input', event => { if (event.target.id === 'search') { state.search = event.target.value; $('#lesson-results').innerHTML = lessonCards(); } });
function addFiles(files) {
  captureDraft(); const combined = [...state.draft.files, ...files];
  if (combined.length > 20 || combined.some(f => f.size > 10 * 1024 * 1024) || combined.reduce((n, f) => n + f.size, 0) > 30 * 1024 * 1024) return toast('Tối đa 20 tệp, 10 MB mỗi tệp và 30 MB tổng cộng.');
  if (combined.some(f => !/\.(png|jpe?g|webp|zip)$/i.test(f.name))) return toast('Chỉ hỗ trợ JPG, PNG, WebP hoặc ZIP.');
  state.draft.files = combined; renderEditor();
}
document.addEventListener('change', event => { if (event.target.id === 'ai-files') addFiles([...event.target.files]); if (event.target.matches('.option-editor input[type=checkbox]')) { const container = event.target.closest('.options-editor'); container.querySelectorAll('.option-editor').forEach(el => el.classList.toggle('correct-option', el.querySelector('input[type=checkbox]').checked)); } });
document.addEventListener('dragover', event => { if (event.target.closest('#drop-zone')) { event.preventDefault(); event.target.closest('#drop-zone').classList.add('dragover'); } });
document.addEventListener('dragleave', event => event.target.closest('#drop-zone')?.classList.remove('dragover'));
document.addEventListener('drop', event => { if (event.target.closest('#drop-zone')) { event.preventDefault(); if (!state.draft.busy) addFiles([...event.dataTransfer.files]); } });
document.addEventListener('keydown', event => {
  const modal = $('#modal-root .modal'); if (!modal) return;
  if (event.key === 'Escape') closeModal();
  if (event.key === 'Tab') { const focusable = [...modal.querySelectorAll('button:not(:disabled), input, select, textarea')]; const first = focusable[0], last = focusable.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
});
window.addEventListener('beforeunload', event => { if (state.page === 'editor') { event.preventDefault(); event.returnValue = ''; } });
const savedToken = sessionStorage.getItem('qh_token');
if (savedToken) {
  try {
    const me = await api('/me');
    state.user = me.user;
    state.aiEnabled = me.aiEnabled;
    await refresh();
  } catch (error) {
    sessionStorage.removeItem('qh_token');
    state.user = null;
  }
} else {
  state.user = null;
}
render();

function adoptExam(exam) {state.exam=exam;state.examReceived=performance.now();state.examRemaining=Math.max(0,Date.parse(exam.deadline)-Date.parse(exam.server_now));}
function renderExam() {shell(examContent({exam:state.exam,index:state.examIndex,button,icon,esc,saving:state.examSaving}));updateExamClock();}
let examPollPending=false,examLastPoll=0;
async function updateExamClock(){
  if(state.page!=='exam'||!state.exam||state.exam.finished_at)return;
  const remaining=Math.max(0,state.examRemaining-(performance.now()-state.examReceived));
  const clock=$('#exam-timer'),seconds=Math.ceil(remaining/1000);
  if(clock)clock.textContent=remaining>0?String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0'):'Hết giờ · đang chốt bài';
  if(remaining<=0&&!examPollPending&&!state.examSaving&&performance.now()-examLastPoll>3000){
    examPollPending=true;examLastPoll=performance.now();const id=state.exam.id;
    try{const result=await api('/exams/'+id);if(state.exam?.id===id){adoptExam(result);if(state.page==='exam')renderExam();}}
    catch(error){toast('Không đồng bộ được thời gian: '+error.message);}
    finally{examPollPending=false;}
  }
}
setInterval(updateExamClock,500);
document.addEventListener('change',event=>{if(event.target.id==='exam-subject'){const subject=state.examSubjects.find(s=>s.id===event.target.value);$('#exam-count').max=Math.min(500,subject.count);$('#exam-count').value=Math.max(1,Math.min(Number($('#exam-count').value),subject.count,500));}});
