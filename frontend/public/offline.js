// "Try again" on the offline page. A file, not an onclick attribute: the CSP forbids inline scripts.
document.getElementById('retry')?.addEventListener('click', () => location.reload());
