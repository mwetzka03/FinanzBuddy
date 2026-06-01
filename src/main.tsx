import './app.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { LocaleProvider } from './i18n/LocaleProvider';
import { DeveloperModeProvider } from './lib/developerMode';
import { ThemeProvider } from './lib/theme';
import { LoadingProvider } from './lib/loading';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <LocaleProvider>
        <DeveloperModeProvider>
          <BrowserRouter>
            <LoadingProvider>
              <App />
            </LoadingProvider>
          </BrowserRouter>
        </DeveloperModeProvider>
      </LocaleProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
