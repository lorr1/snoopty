/**
 * App Root with Routing
 *
 * Sets up React Router with two main routes:
 * - / : Timeline view (existing functionality)
 * - /dashboard : Metrics dashboard view (new)
 */

import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Timeline from './pages/Timeline';

export default function App() {
  return (
    <BrowserRouter basename="/ui">
      <Routes>
        <Route path="/" element={<Timeline />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
  );
}
