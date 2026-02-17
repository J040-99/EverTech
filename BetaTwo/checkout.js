// checkout.js
const stripe = Stripe("pk_test_51T1qYeLTrivMFSU9IqlKg4s4GGFxrPBqBUmBLUVOREwtonXqKOWvCuTtn1PTnleI1vdvt2KwR7BtICngVAE5G4E400vHdfFUaL");

initialize();

async function initialize() {
  // Get the user key from the URL query params (passed from index.html)
  const urlParams = new URLSearchParams(window.location.search);
  const userKey = urlParams.get('key');

  if(!userKey) {
      document.body.innerHTML = '<h3 style="color:red; text-align:center">Erro: Chave de utilizador em falta. Volta ao Hub.</h3>';
      return;
  }

  const fetchClientSecret = async () => {
    const response = await fetch("/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: userKey }), // Send key to backend
    });
    const { clientSecret } = await response.json();
    return clientSecret;
  };

  const checkout = await stripe.initEmbeddedCheckout({
    fetchClientSecret,
  });

  checkout.mount('#checkout');
}
