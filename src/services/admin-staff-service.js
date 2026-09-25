import { supabase } from "../lib/supabase.js";

function throwRpcError(error) {
  if (error) {
    throw new Error(error.message || "Something went wrong. Please try again.");
  }
}

export async function getAdminStaff(sessionToken) {
  const { data, error } = await supabase.rpc("get_admin_staff", {
    p_session_token: sessionToken,
  });

  throwRpcError(error);

  return (data || []).map((row) => ({
    workerId: row.worker_id,
    displayName: row.display_name,
    username: row.username,
    role: row.role,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at,
    lastShiftDate: row.last_shift_date,
    createdAt: row.created_at,
  }));
}

export async function createWorker(sessionToken, { displayName, username, pin, role }) {
  const { error } = await supabase.rpc("admin_create_worker", {
    p_session_token: sessionToken,
    p_display_name: displayName,
    p_username: username,
    p_pin: pin,
    p_role: role,
  });

  throwRpcError(error);
}

export async function updateWorker(sessionToken, workerId, { displayName, role }) {
  const { error } = await supabase.rpc("admin_update_worker", {
    p_session_token: sessionToken,
    p_worker_id: workerId,
    p_display_name: displayName,
    p_role: role,
  });

  throwRpcError(error);
}

export async function setWorkerActive(sessionToken, workerId, isActive) {
  const { error } = await supabase.rpc("admin_set_worker_active", {
    p_session_token: sessionToken,
    p_worker_id: workerId,
    p_is_active: isActive,
  });

  throwRpcError(error);
}

export async function resetWorkerPin(sessionToken, workerId, newPin) {
  const { error } = await supabase.rpc("admin_reset_worker_pin", {
    p_session_token: sessionToken,
    p_worker_id: workerId,
    p_new_pin: newPin,
  });

  throwRpcError(error);
}
