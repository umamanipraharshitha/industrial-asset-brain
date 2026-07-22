// src/services/operationsStore.js
import { db } from "./firebase.js";
import { doc, getDoc, setDoc, deleteDoc } from "firebase/firestore";

const useLocalStore = process.env.MOCK_WHATSAPP === "true";
const localUsers = new Map();

if (useLocalStore) {
  console.log("🧪 MOCK_WHATSAPP — using in-memory operator store (Firebase skipped).");
}

function defaultUser(operatorId) {
  return {
    id: operatorId,
    tier: "paid",
    messageCount: 0,
    mode: null,
    assets: [],
    schedules: [],
    updatedAt: new Date().toISOString(),
  };
}

function localGet(operatorId) {
  if (!localUsers.has(operatorId)) {
    localUsers.set(operatorId, defaultUser(operatorId));
  }
  return { ...localUsers.get(operatorId) };
}

function localSave(operatorId, data) {
  const current = localGet(operatorId);
  localUsers.set(operatorId, { ...current, ...data, updatedAt: new Date().toISOString() });
}

export async function getUserData(operatorId) {
  if (useLocalStore) return localGet(operatorId);

  try {
    const docRef = doc(db, "whatsapp_users", operatorId);
    const userDoc = await getDoc(docRef);
    if (userDoc.exists()) {
      return userDoc.data();
    }
    const defaultData = defaultUser(operatorId);
    defaultData.tier = "free";
    await setDoc(docRef, defaultData);
    return defaultData;
  } catch (err) {
    console.error(`Error in getUserData for ${operatorId}:`, err.message);
    return defaultUser(operatorId);
  }
}

export async function saveUserData(operatorId, data) {
  if (useLocalStore) {
    localSave(operatorId, data);
    return;
  }

  try {
    const docRef = doc(db, "whatsapp_users", operatorId);
    await setDoc(docRef, { ...data, updatedAt: new Date().toISOString() }, { merge: true });
  } catch (err) {
    console.error(`Error saving operator data for ${operatorId}:`, err.message);
  }
}

export async function upsertAsset(operatorId, asset) {
  const user = await getUserData(operatorId);
  const assets = user.assets || [];
  const idx = assets.findIndex((a) => a.id === asset.id);
  if (idx >= 0) assets[idx] = asset;
  else assets.push(asset);
  await saveUserData(operatorId, { assets });
}

export async function addMaintenanceSchedule(operatorId, schedule) {
  const user = await getUserData(operatorId);
  const schedules = user.schedules || [];
  schedules.push(schedule);
  await saveUserData(operatorId, { schedules });
}

export async function removeMaintenanceSchedule(operatorId, scheduleId) {
  const user = await getUserData(operatorId);
  const schedules = (user.schedules || []).filter((s) => s.id !== scheduleId);
  await saveUserData(operatorId, { schedules });
}

export async function listMaintenanceSchedules(operatorId) {
  const user = await getUserData(operatorId);
  return user.schedules || [];
}

export async function listAssets(operatorId) {
  const user = await getUserData(operatorId);
  return user.assets || [];
}

export async function clearAllOperatorData(operatorId) {
  if (useLocalStore) {
    localUsers.delete(operatorId);
    return;
  }

  try {
    const docRef = doc(db, "whatsapp_users", operatorId);
    await deleteDoc(docRef);
  } catch (err) {
    console.error(`Error clearing operator data for ${operatorId}:`, err.message);
  }
}

export async function setUserMode(operatorId, mode) {
  await saveUserData(operatorId, { mode });
}

export async function incrementMessageCount(operatorId) {
  const user = await getUserData(operatorId);
  const newCount = (user.messageCount || 0) + 1;
  await saveUserData(operatorId, { messageCount: newCount });
  return newCount;
}

export async function setTier(operatorId, tier) {
  await saveUserData(operatorId, { tier });
}
