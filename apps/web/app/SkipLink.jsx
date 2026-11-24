'use client';

export default function SkipLink(){
  function focusMain(){
    const main=document.getElementById('main');
    if(!main)return;
    // Keep the normal hash navigation and make its destination focusable.
    if(!main.hasAttribute('tabindex'))main.setAttribute('tabindex','-1');
    main.focus({preventScroll:true});
  }
  return <a className="skip" href="#main" onClick={focusMain}>Skip to content</a>;
}
