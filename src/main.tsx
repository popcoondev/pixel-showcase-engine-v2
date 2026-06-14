import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import App from './App'
import './index.css'

// エラー監視は本番のみ。トレース/Replay は無し(軽量・無料枠・プライバシー配慮)。
if (import.meta.env.PROD) {
  Sentry.init({
    dsn: 'https://5409da618dfba357af27b142c2b48301@o4511561017458688.ingest.us.sentry.io/4511561031155712',
    environment: 'production',
    tracesSampleRate: 0,
  })
}

function CrashFallback() {
  return (
    <div className="crash-fallback">
      <h3>問題が発生しました</h3>
      <p>申し訳ありません。ページを再読み込みしてください。</p>
      <button onClick={() => window.location.reload()}>再読み込み</button>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <Sentry.ErrorBoundary fallback={<CrashFallback />}>
    <App />
  </Sentry.ErrorBoundary>,
)
