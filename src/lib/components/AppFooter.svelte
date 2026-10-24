<script lang="ts">
  import { APP_CONFIG } from '../config';

  /**
   * Authorship footer. The two credits are rendered as separate statements:
   * the author line is personal authorship; the organisation line is
   * institutional context. They are never merged into one phrase.
   */
</script>

<footer class="footer" data-testid="app-footer">
  <p class="footer__credit">
    <span class="footer__role">{APP_CONFIG.author.role}:</span>
    <a
      class="footer__link"
      href={APP_CONFIG.author.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="{APP_CONFIG.author.name} — opens in a new tab"
    >
      {APP_CONFIG.author.name}
    </a>
  </p>
  <p class="footer__credit">
    <span class="footer__role">{APP_CONFIG.organization.role}:</span>
    <a
      class="footer__link"
      href={APP_CONFIG.organization.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="{APP_CONFIG.organization.name} — opens in a new tab"
    >
      {APP_CONFIG.organization.name}
      <span class="footer__arrow" aria-hidden="true">↗</span>
    </a>
  </p>
</footer>

<style>
  .footer {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-5);
    flex: none;
    min-height: 44px;
    padding: var(--space-2) var(--space-4);
    border-top: var(--border);
    background: var(--brand-white);
    font-size: 12px;
  }

  .footer__credit {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem 0.5rem;
    color: var(--color-text-muted);
    line-height: 1.4;
    max-width: none;
  }

  .footer__role {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .footer__link {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-family: var(--font-title);
    font-weight: 500;
    color: var(--color-text);
    text-decoration-color: var(--color-link-underline);
  }

  .footer__arrow {
    font-family: var(--font-mono);
    font-size: 11px;
  }

  @media (max-width: 640px) {
    .footer {
      font-size: 11px;
      padding: var(--space-2) var(--space-3);
    }
  }
</style>
