import React from 'react';
import TitleBar from '../../shared/components/TitleBar';
import OverviewCarousel from './OverviewCarousel';
import './Overview.css';

export default function OverviewPage({ revealed, games, onGoHome, onShowcase, onTracker }) {
  return (
    <div className={`app-ui overview-page${revealed ? '' : ' app-ui--hidden'}`}>
      <div className="overview-right">
        <TitleBar />
        <div className="overview-body">
          <div className="overview-main">
            <OverviewCarousel games={games} onBack={onGoHome} onShowcase={onShowcase} onTracker={onTracker} />
          </div>
        </div>
      </div>
    </div>
  );
}
