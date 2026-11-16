// The pure part of merging a pulled row into the local data (same rules as the agent's apply_remote).
package com.dang.dopadam.sync

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** `updatedAt` and the dirty flag of the local row. */
data class LocalState(val updatedAt: Long, val dirty: Boolean)

/**
 * The remote row wins when its `updated_at` is greater than the local one, or equal while the local row is
 * not dirty (the server keeps the later push on a tie, so a clean local row is the one that lost). A dirty
 * local row with an equal stamp stays and is pushed. No local row: the remote one is taken.
 */
fun remoteWins(remoteUpdatedAt: Long, local: LocalState?): Boolean =
    local == null || remoteUpdatedAt > local.updatedAt || (remoteUpdatedAt == local.updatedAt && !local.dirty)

/** JSON text with objects' keys in sorted order, so the same document written by two systems compares equal. */
private fun canonical(value: Any?): String = when (value) {
    is JSONObject -> value.keys().asSequence().sorted().joinToString(",", "{", "}") { JSONObject.quote(it) + ":" + canonical(value.opt(it)) }
    is JSONArray -> (0 until value.length()).joinToString(",", "[", "]") { canonical(value.opt(it)) }
    JSONObject.NULL, null -> "null"
    is String -> JSONObject.quote(value)
    is Double -> if (value % 1.0 == 0.0 && Math.abs(value) < 1e15) value.toLong().toString() else value.toString()
    else -> value.toString()
}

/** True when two JSON documents are the same apart from key order. Text that is not JSON compares as text. */
fun sameJson(a: String, b: String): Boolean {
    if (a == b) return true
    return try {
        canonical(JSONObject(a)) == canonical(JSONObject(b))
    } catch (e: JSONException) {
        false
    }
}
