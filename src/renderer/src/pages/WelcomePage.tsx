import { Icon } from '../Icon'

interface WelcomePageProps {
  onOpenDatabase: () => void
}

export function WelcomePage({ onOpenDatabase }: WelcomePageProps) {
  return <>
    <p className="eyebrow">GET STARTED</p>
    <h2>A little room to work.</h2>
    <p>Open tools from the main menu or toolbar. Each tool has its own window within PlkGap.</p>
    <button className="welcome-link" onClick={onOpenDatabase}>
      <span className="feature-icon"><Icon name="database" size={23} /></span>
      <span>
        <strong>Database</strong>
        <small>View your local connection and storage details.</small>
      </span>
      <Icon name="arrow" />
    </button>
    <div className="welcome-tip">
      <Icon name="cascade" />
      <p>Drag a title bar to move a window. Use <strong>Tile</strong> or <strong>Cascade</strong> to arrange your workspace.</p>
    </div>
  </>
}
