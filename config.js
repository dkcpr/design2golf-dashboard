// Dashboard settings for this client.
// clientName shows at the top of the page. platforms sets the order and names; each id must match a folder in data/.
window.DASHBOARD_CONFIG = {
  clientName: "Design2Golf",
  platforms: [
    { id: "instagram", name: "Instagram" },
    { id: "linkedin", name: "LinkedIn (business)" },
    { id: "linkedin-personal", name: "LinkedIn (Matt)" },
    { id: "youtube", name: "YouTube" }
  ],
  // You normally don't need these: on GitHub Pages the dashboard works out the account and repository itself.
  githubOwner: "",
  githubRepo: "",
  branch: "main",
  staleAfterDays: 10 // a platform is flagged when its newest data is older than this
};
