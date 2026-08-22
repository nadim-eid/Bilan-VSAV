import React from 'react';
import ReactDOM from 'react-dom/client';
import BilanVsav from './BilanVsav.jsx';
import './index.css';
import { StatusBar } from '@capacitor/status-bar';

StatusBar.hide();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BilanVsav />
  </React.StrictMode>
);
