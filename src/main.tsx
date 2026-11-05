import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/jua/400.css';
import './styles/global.css';
import './styles/screens.css';
import './styles/games.css';
import App from './App';
import { useApp } from './store/app';

// 새로고침 시 진행 중이던 게임 화면 대신 첫 화면에서 시작한다
const s = useApp.getState();
if (s.screen === 'play' || s.screen === 'result') s.go('home');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
