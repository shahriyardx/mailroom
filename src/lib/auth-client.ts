"use client";

import { createAuthClient } from "better-auth/react";

/**
 * No baseURL on purpose.
 *
 * A NEXT_PUBLIC_ value is inlined into the bundle when the image is built,
 * so a published image would carry whichever address the build machine had
 * and every install would sign in against that one. The app is always served
 * from its own origin, which the browser already knows, so better-auth is
 * left to use it.
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
