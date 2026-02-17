// return.js
initialize();

async function initialize() {
  const queryString = window.location.search;
  const urlParams = new URLSearchParams(queryString);
  const sessionId = urlParams.get('session_id');
  const userKey = urlParams.get('key');

  const response = await fetch(`/session-status?session_id=${sessionId}&key=${userKey}`);
  const session = await response.json();

  if (session.status == 'open') {
    window.location.replace('/checkout.html')
  } else if (session.status == 'complete') {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('success').classList.remove('hidden');
    document.getElementById('customer-email').textContent = session.customer_email;
  }
}
