function switchTab(tabName, btnElement) {
    const contents = document.querySelectorAll('.fn-tab-content');
    contents.forEach(content => content.classList.remove('active'));

    const buttons = document.querySelectorAll('.tools-subnav button');
    buttons.forEach(btn => btn.classList.remove('active'));

    const targetTab = document.getElementById('tab-' + tabName);
    targetTab.classList.add('active');
    btnElement.classList.add('active');

    const widget = targetTab.querySelector('[data-tallysight-widget-type]');
    if (widget && window.Tallysight && typeof window.Tallysight.init === 'function') {
      window.Tallysight.init();
    }

    window.dispatchEvent(new Event('resize'));
  }