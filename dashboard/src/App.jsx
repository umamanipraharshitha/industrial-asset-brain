import React, { useState } from 'react'
import AdminDashboard from './components/AdminDashboard'
import OperationsAssistant from './components/OperationsAssistant'
import './App.css'

function App() {
  const [view, setView] = useState('assistant')

  return (
    <div className="App">
      <nav className="app-nav">
        <button
          type="button"
          className={view === 'assistant' ? 'active' : ''}
          onClick={() => setView('assistant')}
        >
          Operations Brain
        </button>
        <button
          type="button"
          className={view === 'admin' ? 'active' : ''}
          onClick={() => setView('admin')}
        >
          Telemetry Console
        </button>
      </nav>
      {view === 'assistant' ? <OperationsAssistant /> : <AdminDashboard />}
    </div>
  )
}

export default App
