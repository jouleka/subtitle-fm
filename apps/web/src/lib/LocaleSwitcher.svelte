<script lang="ts">
  import { getLocale, locales, setLocale, type Locale } from '$lib/paraglide/runtime';
  import { m } from '$lib/paraglide/messages';

  let locale = $state<Locale>(getLocale());

  function change(event: Event) {
    locale = (event.currentTarget as HTMLSelectElement).value as Locale;
    setLocale(locale);
  }
</script>

<label class="locale-switcher">
  <span>{m.language_switcher()}</span>
  <select value={locale} onchange={change} aria-label={m.language_switcher()}>
    {#each locales as option}
      <option value={option}>{option === 'es' ? 'Español' : 'English'}</option>
    {/each}
  </select>
</label>

<style>
  .locale-switcher { display: inline-flex; margin-left: auto; align-items: center; gap: 0.35rem; color: #5f6670; font: 700 0.7rem/1 system-ui, sans-serif; }
  .locale-switcher span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  select { border: 1px solid #cfd3da; border-radius: 5px; background: white; padding: 0.25rem 0.35rem; color: #343941; font: inherit; cursor: pointer; }
</style>
