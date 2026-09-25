import { render } from 'preact';
import { App } from './app';
import * as S from './state';

render(<App />, document.getElementById('app')!);

S.api
  .init()
  .then((i) => {
    S.info.value = i;
    S.settings.value = i.settings;
    S.recents.value = i.recents;
    document.body.classList.add(`platform-${i.platform}`);
    if (i.smoke) S.runSmoke();
    else if (i.openAtStart) S.openPath(i.openAtStart);
  })
  .catch(S.fail);
