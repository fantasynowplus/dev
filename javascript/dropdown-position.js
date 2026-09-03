function checkDropdownOverflow(dropdown) {
    const content = dropdown.querySelector('.dropdown-content');
    if (!content) return;

    content.classList.remove('align-right');
    const rect = content.getBoundingClientRect();

    if (rect.right > window.innerWidth) {
        content.classList.add('align-right');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.dropdown').forEach(dropdown => {
        dropdown.addEventListener('mouseenter', () => checkDropdownOverflow(dropdown));
        dropdown.addEventListener('focusin', () => checkDropdownOverflow(dropdown));
    });
});
