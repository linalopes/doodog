<script lang="ts">
  interface Props {
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: 'default' | 'caution';
    onConfirm: () => void;
    onCancel: () => void;
  }

  let {
    open,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    tone = 'default',
    onConfirm,
    onCancel,
  }: Props = $props();

  let dialog = $state<HTMLDialogElement | null>(null);

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  class="dialog"
  aria-labelledby="confirm-title"
  oncancel={(event) => {
    event.preventDefault();
    onCancel();
  }}
>
  <h2 id="confirm-title" class="dialog__title">{title}</h2>
  <p class="dialog__message">{message}</p>
  <div class="dialog__actions">
    <button type="button" class="btn" onclick={onCancel}>{cancelLabel}</button>
    <button
      type="button"
      class="btn"
      class:btn--danger={tone === 'caution'}
      class:btn--primary={tone === 'default'}
      onclick={onConfirm}
    >
      {confirmLabel}
    </button>
  </div>
</dialog>

<style>
  .dialog {
    border: var(--border-strong);
    border-radius: var(--radius);
    padding: var(--space-4);
    max-width: 440px;
    width: calc(100% - var(--space-6));
    color: var(--color-text);
    background: var(--brand-white);
  }

  .dialog::backdrop {
    background: rgba(34, 17, 62, 0.45);
  }

  .dialog__title {
    margin: 0 0 var(--space-2);
    font-size: 20px;
  }

  .dialog__message {
    margin: 0 0 var(--space-4);
    color: var(--color-text-muted);
  }

  .dialog__actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
