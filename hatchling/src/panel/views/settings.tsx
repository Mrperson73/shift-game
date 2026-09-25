// Settings: the pet, sound, the desktop, the panel's theme, custom species and starting over.

import { useState } from 'preact/hooks';
import { mix } from '../../pet/draw';
import { resolveTheme, type Theme, THEME_IDS, type ThemeId } from '../../shared/themes';
import type { Settings } from '../../shared/types';
import { Icon } from '../icons';
import { sfx } from '../sfx';
import { api, growth, info, pet, problems, settings, species, speciesOf, updateSettings } from '../state';
import { BIOMES, setThemeOrigin } from '../theme';
import { radioKeys, Segmented, SettingRow, Slider, SwitchRow } from '../ui';

const REPO = 'https://github.com/Mrperson73/shift-game';

function ThemePreview(props: { t: Theme; clip?: 'left' | 'right' }) {
  const { t } = props;
  const b = BIOMES[t.id];
  const card = t.dark ? mix(t.bg, '#ffffff', 0.08) : mix('#ffffff', t.bg, 0.15);
  const sky1 = mix('#6fb6ee', b.tint, b.tintAmt + (t.dark ? 0.25 : 0));
  const sky2 = mix('#d4ecff', b.tint, b.tintAmt + (t.dark ? 0.2 : 0));
  const id = `tp-${t.id}-${props.clip ?? 'all'}`;
  return (
    <svg class="theme-art" viewBox="0 0 88 60" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={t.dark ? mix(sky1, '#1a1f4a', 0.55) : sky1} />
          <stop offset="1" stop-color={t.dark ? mix(sky2, '#2a2f63', 0.45) : sky2} />
        </linearGradient>
        {props.clip && (
          <clipPath id={`${id}-clip`}>
            <polygon points={props.clip === 'left' ? '0,0 60,0 28,60 0,60' : '60,0 88,0 88,60 28,60'} />
          </clipPath>
        )}
      </defs>
      <g clip-path={props.clip ? `url(#${id}-clip)` : undefined}>
        <rect width="88" height="60" fill={t.bg} />
        <rect width="88" height="8" fill={t.bar} />
        <rect y="8" width="88" height="24" fill={`url(#${id}-sky)`} />
        {t.dark ? <circle cx="68" cy="16" r="3.2" fill="#f5f2e4" /> : <circle cx="68" cy="16" r="3.6" fill="#ffe07a" />}
        {b.prop === 'sea' ? <rect y="24" width="88" height="8" fill={b.far} /> : <path d="M0 26 Q14 17 28 24 T58 21 T88 24 V32 H0Z" fill={mix(b.far, sky2, 0.25)} />}
        {b.prop === 'volcano' && <path d="M50 30 L60 13 L64 13 L74 30Z" fill={mix(b.far, b.mid, 0.5)} />}
        <path d="M0 28 Q20 23 40 27 T88 26 V32 H0Z" fill={b.mid} />
        <rect y="30" width="88" height="3" fill={b.ground} />
        <rect x="7" y="37" width="74" height="17" rx="4" fill={card} />
        <rect x="12" y="42" width="24" height="7" rx="3.5" fill={t.accent} />
        <rect x="41" y="43" width="34" height="2.4" rx="1.2" fill={t.barInk} opacity="0.55" />
        <rect x="41" y="47" width="22" height="2.4" rx="1.2" fill={t.barInk} opacity="0.3" />
      </g>
    </svg>
  );
}

function ThemePicker(props: { value: ThemeId; onPick: (id: ThemeId, el: HTMLElement) => void }) {
  return (
    <div class="themes" role="radiogroup" aria-label="Theme">
      {THEME_IDS.map((id) => {
        const on = id === props.value;
        const t = id === 'auto' ? null : resolveTheme(id, false);
        const name = t ? t.name : 'Auto';
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={name}
            tabIndex={on ? 0 : -1}
            class={`theme ${on ? 'on' : ''}`}
            onClick={(e) => props.onPick(id, e.currentTarget)}
            onKeyDown={(e) => radioKeys(e)}
          >
            <span class="theme-frame">
              {t ? (
                <ThemePreview t={t} />
              ) : (
                <span class="theme-auto">
                  <ThemePreview t={resolveTheme('auto', false)} clip="left" />
                  <ThemePreview t={resolveTheme('auto', true)} clip="right" />
                </span>
              )}
              {on && (
                <span class="theme-check">
                  <Icon name="check" size={13} />
                </span>
              )}
            </span>
            <span class="theme-name">{name}</span>
          </button>
        );
      })}
    </div>
  );
}

export function SettingsView() {
  const s = settings.value!;
  const i = info.value!;
  const p = pet.value;
  const [confirmNew, setConfirmNew] = useState(false);
  const mods = species.value.filter((x) => x.mod);
  const set = (patch: Partial<Settings>) => updateSettings(patch);
  return (
    <>
      <section class="view-head">
        <h1>Settings</h1>
        <p>Changes apply right away and are saved.</p>
      </section>

      <section class="card settings-card">
        <h2 class="card-title">
          <Icon name="footprint" size={18} />
          Your pet
        </h2>
        <SettingRow label="Size" hint="On your desktop">
          <Segmented label="Size" value={s.size} options={[['S', 'Small'], ['M', 'Medium'], ['L', 'Large']]} onChange={(size) => set({ size })} />
        </SettingRow>
        <SettingRow label="Energy" hint="How busy it is">
          <Segmented label="Energy" value={s.activity} options={[['calm', 'Calm'], ['normal', 'Normal'], ['lively', 'Lively']]} onChange={(activity) => set({ activity })} />
        </SettingRow>
        <SettingRow label="Speech" hint="Bubbles and emotes">
          <Segmented label="Speech" value={s.speech} options={[['off', 'Off'], ['emotes', 'Emotes'], ['chatty', 'Chatty']]} onChange={(speech) => set({ speech })} />
        </SettingRow>
      </section>

      <section class="card settings-card">
        <h2 class="card-title">
          <Icon name="speaker" size={18} />
          Sound
        </h2>
        <SwitchRow label="Sounds" hint="Little chirps, roars and clicks" checked={s.sound} onChange={(sound) => set({ sound })} />
        <div class={`setting volume ${s.sound ? '' : 'off'}`}>
          <span class="setting-text">
            <span class="setting-label">Volume</span>
          </span>
          <div class="setting-control grow">
            <Slider
              label="Volume"
              value={s.volume}
              onCommit={(v) => {
                set({ volume: v });
                if (p) sfx.call(speciesOf(p.species).voice, growth.value);
                else sfx.play('click');
              }}
            />
          </div>
        </div>
      </section>

      <section class="card settings-card">
        <h2 class="card-title">
          <Icon name="monitor" size={18} />
          Desktop
        </h2>
        <SwitchRow label="Climb and walk on windows" hint="Otherwise it stays on the taskbar." checked={s.explore} onChange={(explore) => set({ explore })} />
        <SwitchRow label="Hide during full-screen apps" hint="Off: your pet is always visible" checked={s.hideFullscreen} onChange={(hideFullscreen) => set({ hideFullscreen })} />
        <SwitchRow label="React to games" hint="The Isle, Brawlhalla and Minecraft." checked={s.gameReactions} onChange={(gameReactions) => set({ gameReactions })} />
        <SwitchRow label="Start with Windows" hint="Your pet is there when you log in." checked={s.startWithWindows} onChange={(startWithWindows) => set({ startWithWindows })} />
        {i.displays.length > 1 && (
          <SettingRow label="Screen" hint="Where it lives">
            <span class="select-wrap">
              <select
                aria-label="Screen"
                value={String(s.display ?? i.displays.find((d) => d.primary)?.id ?? '')}
                onChange={(e) => {
                  sfx.play('click');
                  set({ display: Number(e.currentTarget.value) });
                }}
              >
                {i.displays.map((d) => (
                  <option key={d.id} value={String(d.id)}>
                    {d.label}
                    {d.primary ? ' (main)' : ''}
                  </option>
                ))}
              </select>
            </span>
          </SettingRow>
        )}
      </section>

      <section class="card settings-card">
        <h2 class="card-title">
          <Icon name="brush" size={18} />
          Theme
        </h2>
        <ThemePicker
          value={s.theme}
          onPick={(theme, el) => {
            if (theme === s.theme) return;
            const r = el.getBoundingClientRect();
            setThemeOrigin({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
            sfx.play('select');
            set({ theme });
          }}
        />
        <p class="card-note">Each theme is also a new home for your pet's habitat.</p>
      </section>

      <section class="card settings-card">
        <h2 class="card-title">
          <Icon name="puzzle" size={18} />
          Custom species
        </h2>
        <p class="card-text">Add your own dinosaurs as small JSON files. The folder has a guide and an example you can hand to an AI.</p>
        {mods.length > 0 && <p class="mods-ok">Loaded: {mods.map((m) => m.name).join(', ')}</p>}
        {problems.value.length > 0 && (
          <ul class="mods-bad">
            {problems.value.map((x) => (
              <li key={x.file}>
                <Icon name="warn" size={16} />
                <span>
                  <b>{x.file}</b>: {x.error}
                </span>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          class="btn"
          onClick={() => {
            sfx.play('click');
            api.openModsFolder();
          }}
        >
          <Icon name="folder" size={18} />
          Open species folder
        </button>
      </section>

      {p && (
        <section class={`card settings-card new-egg ${confirmNew ? 'confirming' : ''}`}>
          <h2 class="card-title">
            <Icon name="egg" size={18} />
            New egg
          </h2>
          {confirmNew ? (
            <div class="confirm" role="alertdialog" aria-label="Start over with a new egg?">
              <p class="card-text">
                <b>Start over with a new egg?</b> {p.name} will be remembered in your past pets, but you can't bring them back.
              </p>
              <div class="btn-row">
                <button
                  type="button"
                  class="btn ghost"
                  autoFocus
                  onClick={() => {
                    sfx.play('click');
                    setConfirmNew(false);
                  }}
                >
                  Keep {p.name}
                </button>
                <button
                  type="button"
                  class="btn danger"
                  onClick={() => {
                    sfx.play('click');
                    void api.newEgg();
                  }}
                >
                  Choose a new egg
                </button>
              </div>
            </div>
          ) : (
            <>
              <p class="card-text">Ready for a new friend? You can hatch a different egg at any time.</p>
              <button
                type="button"
                class="btn"
                onClick={() => {
                  sfx.play('open');
                  setConfirmNew(true);
                }}
              >
                <Icon name="eggCrack" size={18} />
                Hatch a new egg…
              </button>
            </>
          )}
        </section>
      )}

      <footer class="about">
        <span>Hatchling {i.version}</span>
        <span class="dot" aria-hidden="true" />
        <span>works offline, no tracking</span>
        <span class="dot" aria-hidden="true" />
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            api.openExternal(REPO);
          }}
        >
          <Icon name="github" size={14} />
          source
        </a>
      </footer>
    </>
  );
}
