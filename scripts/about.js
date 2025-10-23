// 아주 얕은 인터섹션 리빌: 요소가 보이면 천천히 떠오르기
(function(){
  const items = document.querySelectorAll('.ax-reveal, .ax-card, .ax-divider, .ax-bottom');
  if(!('IntersectionObserver' in window) || items.length === 0){
    items.forEach(el => el.classList.add('is-in'));
    return;
  }

  const io = new IntersectionObserver((entries)=>{
    entries.forEach(entry=>{
      if(entry.isIntersecting){
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 });

  items.forEach(el => io.observe(el));
})();
