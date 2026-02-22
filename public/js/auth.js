const isSignup = window.location.pathname.includes('signup');
const form = document.getElementById(isSignup ? 'signupForm' : 'loginForm');
const submitBtn = document.getElementById('submitBtn');
const errorDiv = document.getElementById('error');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  errorDiv.style.display = 'none';
  submitBtn.disabled = true;
  submitBtn.textContent = isSignup ? 'CREATING...' : 'SIGNING IN...';

  try {
    const response = await fetch(`/api/auth/${isSignup ? 'signup' : 'login'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Authentication failed');
    }

    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    
    window.location.href = '/chat.html';
  } catch (error) {
    errorDiv.textContent = error.message;
    errorDiv.style.display = 'block';
    submitBtn.disabled = false;
    submitBtn.textContent = isSignup ? 'CREATE ACCOUNT' : 'SIGN IN';
  }
});
