import React, { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, NavLink, Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './i18n';
import './styles.css';
import Home from './pages/Home';
const MapPage = lazy(() => import('./pages/MapPage'));
const Admin = lazy(() => import('./pages/Admin'));
const ProjectPage = lazy(() => import('./pages/ProjectPage'));
const FarmPage = lazy(() => import('./pages/FarmPage'));
const FollowUps = lazy(() => import('./pages/FollowUps'));
const FunderPortal = lazy(() => import('./pages/FunderPortal'));
const Ranking = lazy(() => import('./pages/Ranking'));
const OwnerPortal = lazy(() => import('./pages/Phase7').then(m => ({ default: m.OwnerPortal })));
const Notifications = lazy(() => import('./pages/Phase7').then(m => ({ default: m.Notifications })));
const Checkout = lazy(() => import('./pages/Shop').then(m => ({ default: m.Checkout })));
const Compare = lazy(() => import('./pages/Phase7').then(m => ({ default: m.Compare })));
const Certificate = lazy(() => import('./pages/FunderPortal').then(m => ({ default: m.Certificate })));
const Invitation = lazy(() => import('./pages/FunderPortal').then(m => ({ default: m.Invitation })));
const PRINT = new URLSearchParams(location.search).get('print') === '1';
const EMBED = location.pathname.startsWith('/widget/');
const Impact = lazy(() => import('./pages/Impact'));
const Methodology = lazy(() => import('./pages/Methodology'));
const Downloads = lazy(() => import('./pages/Downloads'));
const Contribution = lazy(() => import('./pages/Contribution'));
const Legal = lazy(() => import('./pages/Legal'));

function Layout() {
  const { t, i18n } = useTranslation();
  const [lang, setLang] = useState(i18n.language);
  const loc = useLocation(); const [unread, setUnread] = useState<number | null>(null);
  // the bell only exists for signed-in users: ask who is signed in first, so that visitors trigger no refused request
  useEffect(() => { fetch('/api/auth/me', { credentials: 'same-origin' }).then(r => r.json()).then(m => (m ? fetch('/api/me/notifications', { credentials: 'same-origin' }).then(r => r.json()).then(j => setUnread(j.unread ?? 0)) : setUnread(null))).catch(() => setUnread(null)); }, [loc.pathname]);
  useEffect(() => { document.documentElement.lang = lang; i18n.changeLanguage(lang); try { localStorage.setItem('fg_lang', lang); } catch {} }, [lang]);
  const link = ({ isActive }: { isActive: boolean }) => `px-2.5 sm:px-3 py-2 rounded-lg text-sm font-medium ${isActive ? 'bg-soil text-white' : 'hover:bg-mist'}`;
  return (
    <div className="min-h-screen flex flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-[2000] focus:bg-white focus:p-2">{t('nav.skip')}</a>
      {PRINT && !location.pathname.startsWith('/certificat/') && <div className="px-4 pt-4 mx-auto max-w-6xl w-full flex items-center justify-between"><img src="/brand/logo.svg" alt="Carbone Farmers" className="h-9" /><span className="font-bold text-soil">Farmgate Credits</span></div>}
      <header className={`border-b border-line bg-white/95 backdrop-blur sticky top-0 z-[1100] print:hidden ${PRINT || EMBED ? 'hidden' : ''}`}>
        <div className="mx-auto max-w-[1500px] px-3 sm:px-4 h-14 flex items-center gap-2 sm:gap-3">
          <Link to="/" className="mr-auto flex items-center gap-3" aria-label="Farmgate Credits — Carbone Farmers"><img src="/brand/logo.svg" alt="Carbone Farmers" className="h-8 w-auto hidden sm:block" /><img src="/brand/icon.svg" alt="" className="h-8 w-auto sm:hidden" /><span className="hidden min-[430px]:inline font-bold text-soil text-sm sm:text-lg sm:border-l sm:border-line sm:pl-3">Farmgate Credits</span></Link>
          <nav aria-label="Navigation" className="flex items-center gap-1">
            <NavLink to="/" end className={link}>{t('nav.home')}</NavLink>
            <NavLink to="/carte" className={link}>{t('nav.map')}</NavLink>
            <NavLink to="/impact" className={link}>{t('p8.impact')}</NavLink>
            <NavLink to="/methodologie" className={`${link({ isActive: loc.pathname === '/methodologie' })} hidden md:inline-block`} >{t('p8.method')}</NavLink>
            <NavLink to="/donnees" className={`${link({ isActive: loc.pathname === '/donnees' })} hidden lg:inline-block`}>{t('p8.data')}</NavLink>
            <details className="relative" key={loc.pathname}><summary className="list-none cursor-pointer px-2.5 sm:px-3 py-2 rounded-lg text-sm font-medium hover:bg-mist select-none">{t('p8.spaces')} ▾</summary>
              <div className="absolute right-0 mt-1 w-56 card p-1 shadow-lg z-[1200]">{[['/selection', t('rk.nav')], ['/suivis', t('fu.nav')], ['/comparer', t('cp.nav')], ['/financeur', t('fo.nav')], ['/porteur', t('ow.nav')], ['/admin', t('nav.admin')], ['/methodologie', t('p8.method')], ['/donnees', t('p8.data')]].map(([to, l]) => <Link key={to} to={to} className={`block px-3 py-2 rounded-lg text-sm hover:bg-mist ${(to === '/methodologie' ? 'md:hidden ' : to === '/donnees' ? 'lg:hidden ' : '')}`}>{l}</Link>)}</div></details>
          </nav>
          {unread !== null && <Link to="/notifications" className="btn-ghost relative" aria-label={`${t('no.title')}${unread ? ` (${unread})` : ''}`}>🔔{unread > 0 && <span className="absolute -top-1 -right-1 bg-brown text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{unread}</span>}</Link>}
          <button className="btn-ghost" onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')} aria-label={lang === 'fr' ? 'Switch to English' : 'Passer en français'}>{lang === 'fr' ? 'EN' : 'FR'}</button>
        </div>
      </header>
      <main id="main" className="flex-1">
        <Suspense fallback={<p className="p-8">{t('loading')}</p>}>
          <Routes><Route path="/" element={<Home />} /><Route path="/impact" element={<Impact />} /><Route path="/methodologie" element={<Methodology />} /><Route path="/donnees" element={<Downloads />} /><Route path="/contribution/:slug" element={<Contribution />} /><Route path="/widget/:slug" element={<Contribution embed />} /><Route path="/mentions-legales" element={<Legal />} /><Route path="/carte" element={<MapPage />} /><Route path="/admin" element={<Admin />} /><Route path="/projets/:slug" element={<ProjectPage />} /><Route path="/fermes/:id" element={<FarmPage />} /><Route path="/suivis" element={<FollowUps />} /><Route path="/financeur" element={<FunderPortal />} /><Route path="/selection" element={<Ranking />} /><Route path="/porteur" element={<OwnerPortal />} /><Route path="/notifications" element={<Notifications />} /><Route path="/comparer" element={<Compare />} /><Route path="/acheter" element={<Checkout />} /><Route path="/certificat/:reference" element={<Certificate />} /><Route path="/invitation/:token" element={<Invitation />} /></Routes>
        </Suspense>
      </main>
      {!PRINT && !EMBED && <footer className="border-t border-line bg-white mt-10 print:hidden"><div className="mx-auto max-w-6xl px-4 py-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm"><img src="/brand/logo.svg" alt="Carbone Farmers" className="h-7" /><Link className="underline" to="/impact">{t('p8.impact')}</Link><Link className="underline" to="/methodologie">{t('p8.method')}</Link><Link className="underline" to="/donnees">{t('p8.data')}</Link><Link className="underline" to="/mentions-legales">{t('p8.legal')}</Link><span className="opacity-70 text-xs sm:ml-auto">{t('p.caution')}</span></div></footer>}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><Layout /></BrowserRouter></React.StrictMode>);
