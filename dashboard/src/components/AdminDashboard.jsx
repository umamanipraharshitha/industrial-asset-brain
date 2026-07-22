import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, onSnapshot, doc, updateDoc, deleteDoc, setDoc, getDoc } from "firebase/firestore";
import "./AdminDashboard.css";

const AdminDashboard = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(
    sessionStorage.getItem("isAdminLoggedIn") === "true"
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  const [users, setUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [tierFilter, setTierFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [newPhoneNumber, setNewPhoneNumber] = useState("");

  useEffect(() => {
    if (!isAuthenticated) return;

    const usersCollection = collection(db, "whatsapp_users");
    const unsubscribe = onSnapshot(
      usersCollection,
      (snapshot) => {
        const usersList = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setUsers(usersList);
        setLoading(false);
      },
      (err) => {
        console.error("Error fetching users: ", err);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [isAuthenticated]);

  const handleLogin = (e) => {
    e.preventDefault();
    if (username === "aplora" && password === "Harshi@123") {
      setIsAuthenticated(true);
      sessionStorage.setItem("isAdminLoggedIn", "true");
      setLoginError("");
    } else {
      setLoginError("❌ Invalid credentials. Please try again.");
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    sessionStorage.removeItem("isAdminLoggedIn");
    setUsername("");
    setPassword("");
  };

  const toggleTier = async (userId, currentTier) => {
    try {
      const userRef = doc(db, "whatsapp_users", userId);
      const newTier = currentTier === "paid" ? "free" : "paid";
      await updateDoc(userRef, { tier: newTier });
    } catch (err) {
      alert("Failed to update tier: " + err.message);
    }
  };

  const resetCount = async (userId) => {
    try {
      const userRef = doc(db, "whatsapp_users", userId);
      await updateDoc(userRef, { messageCount: 0 });
    } catch (err) {
      alert("Failed to reset count: " + err.message);
    }
  };

  const deleteUser = async (userId) => {
    if (window.confirm(`Are you sure you want to delete user ${userId}?`)) {
      try {
        const userRef = doc(db, "whatsapp_users", userId);
        await deleteDoc(userRef);
      } catch (err) {
        alert("Failed to delete user: " + err.message);
      }
    }
  };

  const handleRegisterPremium = async (e) => {
    e.preventDefault();
    const formattedNumber = newPhoneNumber.trim();
    if (!formattedNumber) return;

    try {
      const userRef = doc(db, "whatsapp_users", formattedNumber);
      const userDoc = await getDoc(userRef);

      if (userDoc.exists()) {
        await updateDoc(userRef, { tier: "paid" });
        alert(`Successfully upgraded ${formattedNumber} to Premium Operator (Paid).`);
      } else {
        const defaultData = {
          id: formattedNumber,
          tier: "paid",
          messageCount: 0,
          mode: null,
          assets: [],
          schedules: [],
          updatedAt: new Date().toISOString()
        };
        await setDoc(userRef, defaultData);
        alert(`Successfully registered ${formattedNumber} as a Premium Operator.`);
      }
      setNewPhoneNumber("");
    } catch (err) {
      alert("Failed to register premium number: " + err.message);
    }
  };

  // --- Calculations for Analytics ---
  const totalUsers = users.length;
  const paidUsers = users.filter((u) => u.tier === "paid").length;
  const freeUsers = totalUsers - paidUsers;
  const totalMessages = users.reduce((sum, u) => sum + (u.messageCount || 0), 0);

  const modeDistribution = users.reduce((acc, u) => {
    const mode = u.mode || "Not Set";
    acc[mode] = (acc[mode] || 0) + 1;
    return acc;
  }, {});

  const getModeLabel = (mode) => {
    switch (String(mode)) {
      case "1":
        return "1: Ingestion";
      case "2":
        return "2: Asset Copilot (RAG)";
      case "3":
        return "3: Compliance QA";
      case "4":
        return "4: Maintenance Schedules";
      default:
        return "Not Set / Menu";
    }
  };

  // --- Filtering ---
  const filteredUsers = users.filter((u) => {
    const matchesSearch = u.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTier = tierFilter === "all" || u.tier === tierFilter;
    return matchesSearch && matchesTier;
  });

  if (!isAuthenticated) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="login-logo">
            <h2>Operations Intelligence</h2>
            <span className="badge">Admin Portal</span>
          </div>
          <p>Please enter administrator ID and security key to access the control panel.</p>
          <form onSubmit={handleLogin}>
            <div className="input-group">
              <label>Admin ID</label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter admin ID"
              />
            </div>
            <div className="input-group">
              <label>Security Key</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter security key"
              />
            </div>
            {loginError && <p className="error-message">{loginError}</p>}
            <button type="submit" className="btn-login">
              Acknowledge & Login
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-dashboard">
      <header className="admin-header">
        <div className="header-top">
          <div className="header-logo">
            <h1>Asset Operations Intelligence</h1>
            <span className="badge">Master Admin Console</span>
          </div>
          <button onClick={handleLogout} className="btn-logout">
            Secure Logout
          </button>
        </div>
        <p>Monitor plant engineer sessions, adjust operational tiers, and analyze usage telemetry in real-time.</p>
      </header>

      {/* Analytics Grid */}
      <section className="analytics-grid">
        <div className="analytics-card">
          <h3>Active Field Operators</h3>
          <p className="stat">{totalUsers}</p>
          <div className="sub-stat">
            <span className="free">{freeUsers} Trial</span> • <span className="paid">{paidUsers} Premium</span>
          </div>
        </div>

        <div className="analytics-card">
          <h3>RAG & Schedule Queries</h3>
          <p className="stat">{totalMessages}</p>
          <div className="sub-stat">Telemetry transactions</div>
        </div>

        <div className="analytics-card">
          <h3>License Conversion</h3>
          <p className="stat">
            {totalUsers > 0 ? ((paidUsers / totalUsers) * 100).toFixed(1) : 0}%
          </p>
          <div className="sub-stat">{paidUsers} premium operators</div>
        </div>

        <div className="analytics-card">
          <h3>Operator Modes Distribution</h3>
          <div className="modes-list">
            {Object.entries(modeDistribution).map(([mode, count]) => (
              <div key={mode} className="mode-stat-row">
                <span>{getModeLabel(mode)}</span>
                <span className="count-badge">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Manual Premium User Registration */}
      <section className="registration-section">
        <div className="registration-card">
          <h2>Register Premium Operator</h2>
          <form onSubmit={handleRegisterPremium} className="registration-form">
            <input
              type="text"
              placeholder="e.g. whatsapp:+919876543210"
              value={newPhoneNumber}
              onChange={(e) => setNewPhoneNumber(e.target.value)}
              required
            />
            <button type="submit" className="btn-register">Register Operator</button>
          </form>
        </div>
      </section>

      {/* Filter and Search Bar */}
      <section className="controls-row">
        <div className="search-box">
          <input
            type="text"
            placeholder="Search by WhatsApp credentials..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="filter-box">
          <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
            <option value="all">All Tiers</option>
            <option value="free">Trial Tier</option>
            <option value="paid">Premium Tier</option>
          </select>
        </div>
      </section>

      {/* Users Table */}
      <section className="table-container">
        {loading ? (
          <div className="loader">Synchronizing node telemetry...</div>
        ) : filteredUsers.length === 0 ? (
          <div className="no-records">No operational operator nodes registered.</div>
        ) : (
          <table className="users-table">
            <thead>
              <tr>
                <th>Operator Phone ID</th>
                <th>Access Level</th>
                <th>Query Count</th>
                <th>Operational Mode</th>
                <th>Last Ping Time</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id}>
                  <td className="user-phone">{user.id}</td>
                  <td>
                    <span className={`tier-badge ${user.tier}`}>
                      {user.tier === "paid" ? "PREMIUM" : "TRIAL"}
                    </span>
                  </td>
                  <td>
                    <span className="message-count">{user.messageCount || 0}</span>
                    <span className="limit-hint">/10</span>
                  </td>
                  <td>
                    <span className="mode-badge">
                      {getModeLabel(user.mode)}
                    </span>
                  </td>
                  <td className="timestamp">
                    {user.updatedAt ? new Date(user.updatedAt).toLocaleString() : "Never"}
                  </td>
                  <td className="actions-cell">
                    <button
                      onClick={() => toggleTier(user.id, user.tier)}
                      className={`btn-tier ${user.tier}`}
                    >
                      {user.tier === "paid" ? "Revoke Premium" : "Grant Premium"}
                    </button>
                    <button onClick={() => resetCount(user.id)} className="btn-reset">
                      Reset
                    </button>
                    <button onClick={() => deleteUser(user.id)} className="btn-delete">
                      De-register
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};

export default AdminDashboard;
