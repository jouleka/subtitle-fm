<script lang="ts">
  const year = new Date().getFullYear();
</script>

<footer class="site-footer">
  <div class="footer-brand">
    <a href="/">Subtitle.fm</a>
    <p>Professional subtitle production,<br />built around human judgment.</p>
  </div>
  <div class="footer-links">
    <span>Product</span>
    <a href="/#workflow">Workflow</a>
    <a href="/#difference">Why Subtitle.fm</a>
    <a href="/#catalog">Catalog</a>
  </div>
  <div class="footer-links">
    <span>Platform</span>
    <a href="/dashboard">API dashboard</a>
    <a href="/#submit">Submit an episode</a>
    <a href="/sitemap.xml">Sitemap</a>
  </div>
  <div class="footer-links">
    <span>Legal</span>
    <a href="/legal/takedown">Copyright & takedown</a>
  </div>
  <div class="footer-bottom">
    <span>© {year} Subtitle.fm</span>
    <span>Open formats. Accountable releases.</span>
  </div>
</footer>

<style>
  .site-footer { display: grid; grid-template-columns: 1.6fr repeat(3, 0.6fr); gap: 3rem; width: min(1240px, calc(100% - 3rem)); margin: 0 auto; padding: 5rem 0 2rem; }
  .footer-brand a { color: #1f2425; font-size: 1.15rem; font-weight: 850; letter-spacing: -0.04em; text-decoration: none; }
  .footer-brand p { color: #777e7d; font-size: 0.7rem; line-height: 1.6; }
  .footer-links { display: grid; align-content: start; gap: 0.65rem; }
  .footer-links span { margin-bottom: 0.25rem; color: #9a9e9b; font-size: 0.56rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
  .footer-links a { color: #4f5756; font-size: 0.68rem; text-decoration: none; }
  .footer-links a:hover { color: #bd654d; }
  .footer-bottom { display: flex; grid-column: 1 / -1; justify-content: space-between; border-top: 1px solid #c4c5bf; padding-top: 1.2rem; color: #858a89; font-size: 0.56rem; }

  @media (max-width: 860px) {
    .site-footer { grid-template-columns: 1.4fr repeat(3, 0.7fr); width: min(100% - 2rem, 1240px); gap: 1.5rem; }
  }

  @media (max-width: 620px) {
    .site-footer { grid-template-columns: 1fr 1fr; width: min(100% - 1.25rem, 1240px); }
    .footer-brand { grid-column: 1 / -1; }
    .footer-links:nth-child(4) { grid-column: 1 / -1; }
  }
</style>
