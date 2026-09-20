// Public contact links, rendered by the web sidebar and served to the agent's
// get_contact_information tool. Unset values simply don't render — the sidebar
// hides the button and the tool reports there is nothing to share. Use full
// schemes: `mailto:` for email, `https://` for the rest.
export const contactConfig = {
  email: process.env.CONTACT_EMAIL ?? "",
  linkedin: process.env.CONTACT_LINKEDIN ?? "",
  github: process.env.CONTACT_GITHUB ?? "",
};
