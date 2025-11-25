/**
 * App Root with Routing
 *
 * Sets up React Router with two main routes:
 * - / : Timeline view (existing functionality)
 * - /dashboard : Metrics dashboard view (new)
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Timeline from './pages/Timeline';
import Dashboard from './pages/Dashboard';

export default function App(): JSX.Element {
  return (
    <BrowserRouter basename="/ui">
      <Routes>
        <Route path="/" element={<Timeline />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
  );
}
