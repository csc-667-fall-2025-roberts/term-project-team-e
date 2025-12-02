

function formatTime(timestamp) {
    const d = new Date(timestamp);
    const now = new Date();

    const sameDay = d.toDateString() === now.toDateString();

    const yest = new Date(now);
    yest.setDate(now.getDate() - 1);
    const isYesterday = d.toDateString() === yest.toDateString();

    const time = d.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
    });

    if (sameDay) return `Today ${time}`;
    if (isYesterday) return `Yesterday ${time}`;

    const date = d.toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric'
    });

    return `${date} · ${time}`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
