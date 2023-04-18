document.addEventListener('DOMContentLoaded', () => {
    const authBtn = document.getElementById('auth-btn');
    authBtn.addEventListener('click', async () => {
        window.location.href = '/api/login';
    });
});
