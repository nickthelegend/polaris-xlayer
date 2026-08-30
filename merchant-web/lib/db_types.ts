export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export interface Database {
    public: {
        Tables: {
            merchant_users: {
                Row: {
                    id: string
                    wallet_address: string
                    email: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    wallet_address: string
                    email?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    wallet_address?: string
                    email?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
            merchant_apps: {
                Row: {
                    id: string
                    user_id: string
                    name: string
                    description: string | null
                    logo_url: string | null
                    category: string | null
                    client_id: string
                    client_secret: string
                    escrow_contract: string | null
                    network: string
                    status: string
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    name: string
                    description?: string | null
                    logo_url?: string | null
                    category?: string | null
                    client_id?: string
                    client_secret?: string
                    escrow_contract?: string | null
                    network?: string
                    status?: string
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    name?: string
                    description?: string | null
                    logo_url?: string | null
                    category?: string | null
                    client_id?: string
                    client_secret?: string
                    escrow_contract?: string | null
                    network?: string
                    status?: string
                    created_at?: string
                    updated_at?: string
                }
            }
            api_keys: {
                Row: {
                    id: string
                    app_id: string
                    key_hash: string
                    label: string | null
                    last_used_at: string | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    app_id: string
                    key_hash: string
                    label?: string | null
                    last_used_at?: string | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    app_id?: string
                    key_hash?: string
                    label?: string | null
                    last_used_at?: string | null
                    created_at?: string
                }
            }
            webhooks: {
                Row: {
                    id: string
                    app_id: string
                    url: string
                    secret: string
                    events: string[]
                    is_active: boolean
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    app_id: string
                    url: string
                    secret: string
                    events: string[]
                    is_active?: boolean
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    app_id?: string
                    url?: string
                    secret?: string
                    events?: string[]
                    is_active?: boolean
                    created_at?: string
                    updated_at?: string
                }
            }
        }
    }
}
