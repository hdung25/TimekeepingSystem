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
        try {
            const auth = AuthHelper.getSecondaryAuth();
            const email = `${username}@tuduytre.com`.toLowerCase(); // Standardization

            // Sign out secondary just in case
            await auth.signOut();

            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            const user = userCredential.user;

            // Sign out immediately so we don't keep session
            await auth.signOut();
            return user;
        } catch (error) {
            // If email already in use, we might want to return that info
            console.error("Auth Create Error:", error);
            throw error;
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

    // "Self-Healing" / Force Update
    // Takes old password from DB to login, then updates to new password.
    syncUser: async (username, oldPasswordFromDB, newPassword) => {
        const auth = AuthHelper.getSecondaryAuth();
        const email = `${username}@tuduytre.com`.toLowerCase();

        try {
            // 1. Try to Login with OLD Password
            await auth.signInWithEmailAndPassword(email, oldPasswordFromDB);

            // 2. Update to NEW Password
            const user = auth.currentUser;
            if (newPassword && newPassword !== oldPasswordFromDB) {
                await user.updatePassword(newPassword);
            }

            // 3. Sign Out
            await auth.signOut();
            return true;

        } catch (e) {
            console.warn("Sync Login Error:", e.code);

            // FALLBACK STRATEGY: Try Common Default Password '123456'
            if (!username.includes("_fallback_attempt")) {
                try {
                    console.log("Sync: Attempting fallback password '123456'...");
                    await auth.signInWithEmailAndPassword(email, '123456');
                    // If success, we are now logged in!
                    const user = auth.currentUser;
                    // Update to the CORRECT new password
                    if (newPassword && newPassword !== '123456') {
                        await user.updatePassword(newPassword);
                    }
                    await auth.signOut();
                    return true;
                } catch (fallbackErr) {
                    console.warn("Fallback failed:", fallbackErr.code);
                }
            }

            // HANDLE EMAIL ENUMERATION PROTECTION (auth/invalid-credential)
            // If protection is on, both "Wrong Password" and "User Not Found" might return 'auth/invalid-credential'
            const retryCodes = ['auth/user-not-found', 'auth/invalid-credential', 'auth/wrong-password'];

            if (retryCodes.includes(e.code)) {

                // Strategy: Assume user is missing and try to CREATE.
                try {
                    console.log("Sync: Login failed, attempting to create user...", email);
                    await AuthHelper.createUser(username, newPassword || oldPasswordFromDB);
                    return true;
                } catch (createErr) {
                    // If creation fails because email exists, THEN we truly have a wrong password (and can't fix it from here)
                    if (createErr.code === 'auth/email-already-in-use') {
                        throw new Error(`Tài khoản Auth tồn tại nhưng sai mật khẩu (và không phải 123456). Không thể đồng bộ!`);
                    }
                    // Other creation errors
                    throw createErr;
                }
            }
            throw e;
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

            // 3. Sign Out (Clean up)
            // Note: delete() usually signs out, but to be sure
            if (auth.currentUser) await auth.signOut();
            return true;
        } catch (e) {
            console.warn("Auth Delete Error:", e.code);
            // If user not found, that's good (already deleted).
            if (e.code === 'auth/user-not-found') return true;

            // If wrong password, we can't delete. That's a limitation.
            // But at least we tried.
            return false;
        }
    }
};
