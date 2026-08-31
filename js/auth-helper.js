// Auth Helper - for Admin Actions
// Allows creating/updating users without signing out the current Admin

const AuthHelper = {
    secondaryApp: null,

    getSecondaryAuth: () => {
        if (!AuthHelper.secondaryApp) {
            // Need firebase config. unique name is important
            AuthHelper.secondaryApp = firebase.initializeApp(firebaseConfig, "SecondaryApp");
        }
        return AuthHelper.secondaryApp.auth();
    },

    // Create a new user in Firebase Auth
    createUser: async (username, password) => {
        const auth = AuthHelper.getSecondaryAuth();
        try {
            const email = `${username}@tuduytre.com`.toLowerCase(); // Standardization

            // Sign out secondary just in case
            await auth.signOut();

            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            const user = userCredential.user;
            return { uid: user.uid, email: user.email };
        } catch (error) {
            // If email already in use, we might want to return that info
            console.error("Auth Create Error:", error);
            throw error;
        } finally {
            // The secondary app must never keep a staff session after an admin action.
            try { await auth.signOut(); } catch (_) { /* best effort cleanup */ }
        }
    },

    // Reset password (by deleting and recreating, or just updating if we know old password)
    // Since we store password in Firestore (legacy requirement of this app), we can sign in!
    updateUserPassword: async (username, newPassword) => {
        try {
            const auth = AuthHelper.getSecondaryAuth();
            const email = `${username}@tuduytre.com`.toLowerCase();

            // 1. We need to sign in as that user to change password
            // Let's assume the caller passes the OLD password (from DB).
            throw new Error("Cannot update password without old password on Client SDK");
        } catch (e) {
            throw e;
        }
    },

    // Authenticate the existing account before changing its email/password. Never
    // guess a default password and never create a new identity after a failed login.
    syncUser: async (username, oldPasswordFromDB, newPassword, nextUsername) => {
        const auth = AuthHelper.getSecondaryAuth();
        const email = `${username}@tuduytre.com`.toLowerCase();
        const nextEmail = `${nextUsername || username}@tuduytre.com`.toLowerCase();

        try {
            await auth.signInWithEmailAndPassword(email, oldPasswordFromDB);
            const user = auth.currentUser;
            if (!user) throw new Error('Không tìm thấy phiên xác thực của nhân viên.');
            let emailChanged = false;
            try {
                if (nextEmail !== email) {
                    await user.updateEmail(nextEmail);
                    emailChanged = true;
                }
                if (newPassword && newPassword !== oldPasswordFromDB) {
                    await user.updatePassword(newPassword);
                }
            } catch (mutationError) {
                if (emailChanged) {
                    try { await user.updateEmail(email); }
                    catch (rollbackError) { console.error('Auth email rollback failed:', rollbackError); }
                }
                throw mutationError;
            }
            return { uid: user.uid, email: nextEmail };
        } catch (e) {
            console.warn("Sync Login Error:", e.code);
            throw e;
        } finally {
            try { await auth.signOut(); } catch (_) { /* best effort cleanup */ }
        }
    },

    // Delete User from Auth (requires password to login first)
    // Prevents "Zombie" accounts when deleting staff
    deleteUser: async (username, password) => {
        const auth = AuthHelper.getSecondaryAuth();
        const email = `${username}@tuduytre.com`.toLowerCase();

        try {
            console.log(`AuthHelper: Auto-deleting auth user ${email}...`);
            // 1. Sign In
            await auth.signInWithEmailAndPassword(email, password);

            // 2. Delete Self
            const user = auth.currentUser;
            if (user) {
                await user.delete();
                console.log("AuthHelper: Deleted successfully.");
            }

            return true;
        } catch (e) {
            console.warn("Auth Delete Error:", e.code);
            // If user not found, that's good (already deleted).
            if (e.code === 'auth/user-not-found') return true;

            // If wrong password, we can't delete. That's a limitation.
            // But at least we tried.
            return false;
        } finally {
            try { await auth.signOut(); } catch (_) { /* best effort cleanup */ }
        }
    }
};
