import test from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/state.js';
import { canAccessFuel } from '../js/fuel-access.js';

test('combustível exige sessão e perfil administrador', () => {
    const original = { user: state.user, role: state.userRole };
    try {
        state.user = { id: 'test-user' }; state.userRole = 'admin';
        assert.equal(canAccessFuel(), true);
        for (const role of ['cadastrador', null, 'outro']) {
            state.userRole = role;
            assert.equal(canAccessFuel(), false);
        }
        state.user = null; state.userRole = 'admin';
        assert.equal(canAccessFuel(), false);
    } finally { state.user = original.user; state.userRole = original.role; }
});
