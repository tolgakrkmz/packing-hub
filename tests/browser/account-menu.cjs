/* Header links and sign-out live in the avatar menu; open it before interacting with them. */
async function openAccountMenu(page) {
  const button = page.locator('#serverAccountButton');
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
}
module.exports = {openAccountMenu};
