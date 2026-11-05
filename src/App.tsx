import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { ToastHost } from './components/ui';
import History from './screens/History';
import Home from './screens/Home';
import Instant from './screens/Instant';
import Outcome from './screens/Outcome';
import Picker from './screens/Picker';
import Play from './screens/Play';
import Players from './screens/Players';
import Result from './screens/Result';
import Settings from './screens/Settings';
import { useApp } from './store/app';

export default function App() {
  const screen = useApp((s) => s.screen);
  const theme = useApp((s) => s.settings.theme);
  const round = useApp((s) => s.round);
  const go = useApp((s) => s.go);

  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', theme);
  }, [theme]);

  // 저장된 상태에 진행 중이던 판이 없으면 첫 화면으로 돌려보낸다
  useEffect(() => {
    if ((screen === 'play' || screen === 'result') && !round) go('home');
  }, [screen, round, go]);

  return (
    <>
      {screen === 'home' && <Home />}
      {screen === 'players' && <Players />}
      {screen === 'outcome' && <Outcome />}
      {screen === 'picker' && <Picker />}
      {screen === 'play' && <Play />}
      {screen === 'result' && <Result />}
      {screen === 'history' && <History />}
      {screen === 'settings' && <Settings />}
      {screen === 'instant' && <Instant />}
      <UpdatePrompt hidden={screen === 'play' || screen === 'instant'} />
      <ToastHost />
    </>
  );
}

/** 새 버전 알림: 게임 중에는 띄우지 않는다 */
function UpdatePrompt({ hidden }: { hidden: boolean }) {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  const [dismissed, setDismissed] = useState(false);
  if (!needRefresh || hidden || dismissed) return null;
  return (
    <div className="update-bar" role="status">
      <span>새 버전이 있어요</span>
      <button className="btn primary small" onClick={() => void updateServiceWorker(true)}>
        새로고침
      </button>
      <button
        className="icon-btn"
        aria-label="닫기"
        onClick={() => {
          setDismissed(true);
          setNeedRefresh(false);
        }}
      >
        ×
      </button>
    </div>
  );
}
