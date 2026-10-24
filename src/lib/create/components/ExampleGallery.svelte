<script lang="ts">
  import { SKETCH_EXAMPLES } from '../../sketches/examples';
  import BrandPattern from '../../components/BrandPattern.svelte';

  interface Props {
    onUseExample: (exampleId: string) => void;
  }

  let { onUseExample }: Props = $props();
</script>

<section class="gallery" aria-label="Built-in examples">
  <header class="gallery__header">
    <h2>Examples</h2>
    <p class="muted">
      Built-in templates stay immutable. Use example creates one editable copy in My sketches
      and runs it.
    </p>
  </header>

  <ul class="gallery__grid">
    {#each SKETCH_EXAMPLES as example, index (example.id)}
      <li class="card">
        <div class="card__art" aria-hidden="true">
          <BrandPattern seed={11 + index * 3} columns={14} rows={6} />
          <span class="card__num">0{index + 1}</span>
        </div>
        <div class="card__body">
          <h3 class="card__title" id="example-title-{example.id}">{example.name}</h3>
          <p class="card__description">{example.description}</p>
          <ul class="card__tags">
            {#each example.tags as tag (tag)}
              <li class="tag">{tag}</li>
            {/each}
          </ul>
          <div class="card__action">
            <button
              type="button"
              class="btn btn--primary btn--small"
              aria-describedby="example-title-{example.id}"
              onclick={() => onUseExample(example.id)}
            >
              Use example
            </button>
          </div>
        </div>
      </li>
    {/each}
  </ul>
</section>

<style>
  .gallery {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .gallery__header h2 {
    margin: 0 0 var(--space-1);
  }

  .gallery__header p {
    margin: 0;
  }

  .gallery__grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 360px));
    gap: var(--space-3);
  }

  .card {
    display: flex;
    flex-direction: column;
    border: var(--border-strong);
    border-radius: var(--radius);
    background: var(--brand-white);
    overflow: hidden;
  }

  .card:hover {
    border-color: var(--brand-deep-purple);
  }

  .card__art {
    position: relative;
    aspect-ratio: 16 / 7;
    background: var(--color-surface-tint);
    border-bottom: var(--border);
    overflow: hidden;
  }

  .card__num {
    position: absolute;
    left: var(--space-3);
    bottom: var(--space-2);
    font-family: var(--font-title);
    font-size: 48px;
    font-weight: 300;
    letter-spacing: -0.04em;
    color: var(--brand-gray-green);
    line-height: 1;
  }

  .card__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
  }

  .card__title {
    margin: 0;
    font-size: 16px;
    font-weight: 500;
  }

  .card__description {
    margin: 0;
    font-size: 13px;
    color: var(--color-text-muted);
  }

  .card__tags {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .card__action {
    margin-top: var(--space-1);
  }
</style>
