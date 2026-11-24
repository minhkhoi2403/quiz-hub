let collapsed = false;
let cleanup = () => {};

export function unmountStudyNavigation() { cleanup(); cleanup = () => {}; }

export function mountStudyNavigation(list) {
  unmountStudyNavigation();
  if (!list) return;
  const cards = [...list.querySelectorAll('.study-card')];
  if (!cards.length) return;
  cards.forEach((card, i) => { card.id = `study-question-${i + 1}`; card.tabIndex = -1; });
  list.classList.add('study-with-navigation');
  const root = document.createElement('div');
  root.className = 'study-navigation';
  root.innerHTML = `<aside id="study-question-picker" class="study-nav-panel" aria-label="Chọn câu hỏi để học">
    <div class="study-nav-heading"><h2>Danh sách câu hỏi</h2><button type="button" class="icon-btn" data-study-action="hide" aria-label="Ẩn bảng chọn câu hỏi" title="Ẩn bảng chọn">→</button></div>
    <p class="study-nav-status">Đang xem câu <strong data-study-current>1</strong> / ${cards.length}</p>
    <div class="study-nav-grid">${cards.map((_,i)=>`<button type="button" class="question-number" data-study-index="${i}" aria-label="Đến câu ${i+1}" aria-controls="study-question-${i+1}">${i+1}</button>`).join('')}</div>
    <p class="help-text">Chọn số câu để chuyển đến. Bảng luôn có thể mở lại ở mép phải màn hình.</p>
    <button type="button" class="btn secondary" data-study-action="hide">Ẩn bảng câu hỏi →</button>
  </aside><button type="button" class="study-nav-toggle" data-study-action="show" aria-controls="study-question-picker" aria-label="Hiện bảng chọn câu hỏi">‹ <span>Hiện câu hỏi</span><small data-study-badge>1 / ${cards.length}</small></button>`;
  document.body.append(root);
  const panel=root.querySelector('.study-nav-panel'), toggle=root.querySelector('.study-nav-toggle'), grid=root.querySelector('.study-nav-grid');
  const buttons=[...grid.querySelectorAll('button')];
  let current=-1, frame=0;
  function revealCurrent() {
    const selected=buttons[current]; if (!selected || collapsed) return;
    const box=selected.getBoundingClientRect(), bounds=grid.getBoundingClientRect();
    if(box.top<bounds.top) grid.scrollTop-=bounds.top-box.top+6;
    else if(box.bottom>bounds.bottom) grid.scrollTop+=box.bottom-bounds.bottom+6;
  }
  function update() {
    frame=0;
    let low=0, high=cards.length-1, active=0;
    while(low<=high){const mid=(low+high)>>1;if(cards[mid].getBoundingClientRect().top<=110){active=mid;low=mid+1;}else high=mid-1;}
    if(active===current)return;
    if(buttons[current]){buttons[current].classList.remove('current');buttons[current].removeAttribute('aria-current');}
    current=active;buttons[current].classList.add('current');buttons[current].setAttribute('aria-current','true');
    root.querySelector('[data-study-current]').textContent=String(current+1);
    root.querySelector('[data-study-badge]').textContent=`${current+1} / ${cards.length}`;
    revealCurrent();
  }
  function setCollapsed(value, focus=false) {
    collapsed=value;panel.hidden=collapsed;toggle.hidden=!collapsed;toggle.setAttribute('aria-expanded',String(!collapsed));
    update();revealCurrent();
    if(focus)(collapsed?toggle:buttons[current]||buttons[0]).focus({preventScroll:true});
  }
  const onScroll=()=>{if(!frame)frame=requestAnimationFrame(update);};
  root.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    event.preventDefault();event.stopPropagation();
    if(button.dataset.studyAction){setCollapsed(button.dataset.studyAction==='hide',true);return;}
    const index=Number(button.dataset.studyIndex);
    if(Number.isInteger(index)&&cards[index]){
      cards[index].scrollIntoView({block:'start',behavior:'instant'});
      cards[index].focus({preventScroll:true});update();
    }
  });
  root.addEventListener('keydown',event=>{if(event.key==='Escape'&&!collapsed){event.preventDefault();setCollapsed(true,true);}});
  window.addEventListener('scroll',onScroll,{passive:true});window.addEventListener('resize',onScroll);
  const observer=new ResizeObserver(onScroll);observer.observe(list);
  setCollapsed(collapsed);
  cleanup=()=>{window.removeEventListener('scroll',onScroll);window.removeEventListener('resize',onScroll);observer.disconnect();cancelAnimationFrame(frame);root.remove();list.classList.remove('study-with-navigation');};
}
