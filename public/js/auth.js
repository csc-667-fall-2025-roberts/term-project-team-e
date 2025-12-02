// Tab switching
const loginTab = document.getElementById('loginTab');
const signupTab = document.getElementById('signupTab');

// the forms
const loginForm = document.getElementById('loginForm');
const signupForm = document.getElementById('signupForm');

loginTab.addEventListener('click', () => {
    loginTab.classList.add('bg-green-600', 'text-white');
    loginTab.classList.remove('text-gray-600', 'hover:bg-gray-50');
    signupTab.classList.remove('bg-green-600', 'text-white');
    signupTab.classList.add('text-gray-600', 'hover:bg-gray-50');
    loginForm.classList.remove('hidden');
    signupForm.classList.add('hidden');
});

signupTab.addEventListener('click', () => {
    signupTab.classList.add('bg-green-600', 'text-white');
    signupTab.classList.remove('text-gray-600', 'hover:bg-gray-50');
    loginTab.classList.remove('bg-green-600', 'text-white');
    loginTab.classList.add('text-gray-600', 'hover:bg-gray-50');
    signupForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
});


(async function guardLoginPage() {
    try {
        const r = await fetch('/api/auth/me', { credentials: 'include' });
        const data = await r.json();
        if (data?.authenticated) {
            return location.replace('/lobby');
        }
    } catch {}
})();



document.getElementById('loginFormElement').addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const errorDiv = document.getElementById('loginError');

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok) {
            // cant go back to login page unless logged out
            location.replace('/lobby');
        } else {
            errorDiv.textContent = data.error || 'Login failed';
            errorDiv.classList.remove('hidden');
        }
    } catch (error) {
        errorDiv.textContent = 'Network error. Please try again.';
        errorDiv.classList.remove('hidden');
    }
});

document.getElementById('signupFormElement').addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('signupEmail').value;
    const username = document.getElementById('signupUsername').value;
    const password = document.getElementById('signupPassword').value;
    const errorDiv = document.getElementById('signupError');

    try {
        const response = await fetch('/api/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email, username, password })
        });

        const data = await response.json();

        if (response.ok) {
            location.replace('/lobby');
        } else {
            errorDiv.textContent = data.error || 'Signup failed';
            errorDiv.classList.remove('hidden');
        }
    } catch (error) {
        errorDiv.textContent = 'Network error. Please try again.';
        errorDiv.classList.remove('hidden');
    }
});