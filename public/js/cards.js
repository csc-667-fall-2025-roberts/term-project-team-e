
function getCardDisplay(value) {
    if (value === -2) return '🃏'; // Joker
    if (value === 0) return 'K';
    if (value === 1) return 'A';
    if (value === 11) return 'J';
    if (value === 12) return 'Q';
    return String(value);
}

function scoreOf(v) {
    if (v === 11 || v === 12) return 10;
    return v;
}

function rankParts(value) {
    if (value === -2) return { corner: 'JKR', center: '🃏', colorClass: 'text-purple-700' };
    if (value === 0)  return { corner: 'K',   center: 'K',   colorClass: 'text-gray-900' };
    if (value === 1)  return { corner: 'A',   center: 'A',   colorClass: 'text-gray-900' };
    if (value === 11) return { corner: 'J',   center: 'J',   colorClass: 'text-gray-900' };
    if (value === 12) return { corner: 'Q',   center: 'Q',   colorClass: 'text-gray-900' };
    return { corner: String(value), center: String(value), colorClass: 'text-gray-900' };
}

function renderFaceUpCard(value, size = 'h-32') {
    const { corner, center, colorClass } = rankParts(value);
    return `
        <div class="relative w-full ${size} rounded-xl shadow-lg bg-white border-2 border-gray-300">
            <div class="absolute top-1 left-1 text-[10px] font-bold ${colorClass} select-none">
                ${corner}
            </div>
            <div class="absolute bottom-1 right-1 text-[10px] font-bold ${colorClass} rotate-180 select-none">
                ${corner}
            </div>
            <div class="w-full h-full flex items-center justify-center text-3xl font-extrabold ${colorClass} select-none">
                ${center}
            </div>
        </div>
    `;
}

function renderFaceDownCard(size = 'h-32') {
    return `
        <div class="relative w-full ${size} rounded-xl shadow-lg
            bg-gradient-to-br from-gray-400 to-gray-600
            border-2 border-gray-700 text-white select-none
            flex items-center justify-center text-2xl">
            🎴
        </div>
    `;
}

// “Self revealed” (face-down but you can see value)
function renderFaceDownRevealed(value, size = 'h-32') {
    const { corner, center } = rankParts(value);
    return `
        <div class="relative w-full ${size} rounded-xl shadow-lg bg-white border-2 border-gray-200 opacity-70">
            <div class="absolute top-1 left-1 text-[10px] font-bold text-gray-500 select-none">
                ${corner}
            </div>
            <div class="absolute bottom-1 right-1 text-[10px] font-bold text-gray-500 rotate-180 select-none">
                ${corner}
            </div>
            <div class="w-full h-full flex items-center justify-center text-3xl font-extrabold text-gray-500 select-none">
                ${center}
            </div>
        </div>
    `;
}


function renderCard(value, isFaceUp, size = 'h-32', mode = 'public') {
    if (isFaceUp) return renderFaceUpCard(value, size);
    return mode === 'self' ? renderFaceDownRevealed(value, size) : renderFaceDownCard(size);
}


function calculateScore(cards) {
    let total = 0;
    const cols = { 0: [], 1: [], 2: [] };

    for (const c of cards) {
        if (c.is_face_up) cols[c.position_col].push(c);
    }

    for (let col = 0; col < 3; col++) {
        const c = cols[col];
        if (c.length === 2) {
            const [a, b] = c;
            if (a.card_value !== b.card_value) {
                total += scoreOf(a.card_value) + scoreOf(b.card_value);
            }
        } else if (c.length === 1) {
            total += scoreOf(c[0].card_value);
        }
    }
    return total;
}
