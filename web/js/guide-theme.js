// The theme of the app (same origin, same settings), set before the guide
// is drawn. A file, not an inline script: the desktop CSP allows only these.
try { document.documentElement.dataset.theme = localStorage.getItem('spline.theme') || 'dark'; } catch { document.documentElement.dataset.theme = 'dark'; }
