export interface paths {
    "/api/backups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Backups */
        get: operations["get_backups_api_backups_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/backups/kobo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Post Backup Kobo */
        post: operations["post_backup_kobo_api_backups_kobo_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/backups/{backup_id}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Post Restore Backup */
        post: operations["post_restore_backup_api_backups__backup_id__restore_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/backups/{backup_id}/restore-preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Restore Preview */
        get: operations["get_restore_preview_api_backups__backup_id__restore_preview_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/covers/{asset_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Cover */
        get: operations["get_cover_api_covers__asset_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/dashboard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Dashboard */
        get: operations["get_dashboard_api_dashboard_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/device/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Device Status */
        get: operations["get_device_status_api_device_status_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/devices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Devices */
        get: operations["get_devices_api_devices_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/devices/{device_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Patch Device */
        patch: operations["patch_device_api_devices__device_id__patch"];
        trace?: never;
    };
    "/api/import/kobo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Post Import Kobo */
        post: operations["post_import_kobo_api_import_kobo_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/import/kobo/auto": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Post Auto Import Kobo */
        post: operations["post_auto_import_kobo_api_import_kobo_auto_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/import/upload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Post Import Upload */
        post: operations["post_import_upload_api_import_upload_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/snapshots": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Snapshots */
        get: operations["get_snapshots_api_snapshots_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/snapshots/{snapshot_id}/device": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Patch Snapshot Device */
        patch: operations["patch_snapshot_device_api_snapshots__snapshot_id__device_patch"];
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** AutoImportResult */
        AutoImportResult: {
            /**
             * Covers Changed
             * @default false
             */
            covers_changed?: boolean;
            device: components["schemas"]["DeviceStatus"];
            /** Imported */
            imported: boolean;
            /**
             * Reason
             * @enum {string}
             */
            reason: "changed" | "unchanged" | "not_mounted" | "database_missing" | "access_blocked" | "device_unassigned";
            snapshot: components["schemas"]["Snapshot"] | null;
        };
        /** BackupResponse */
        BackupResponse: {
            backup: components["schemas"]["RecoveryBackup"];
            /** Created */
            created: boolean;
        };
        /** BackupsResponse */
        BackupsResponse: {
            /** Backups */
            backups: components["schemas"]["RecoveryBackup"][];
        };
        /** Body_post_import_upload_api_import_upload_post */
        Body_post_import_upload_api_import_upload_post: {
            /** Device Id */
            device_id?: string | null;
            /** File */
            file: string;
            /** New Device Label */
            new_device_label?: string | null;
        };
        /** BookStats */
        BookStats: {
            /** Authors */
            authors: string;
            /** Cover Url */
            cover_url?: string | null;
            /** Estimated Remaining Seconds */
            estimated_remaining_seconds: number | null;
            /** Highlight Count */
            highlight_count: number;
            /** Id */
            id: string;
            /** Language */
            language: string;
            /** Last Open */
            last_open: string | null;
            /** Max Page */
            max_page: number | null;
            /** Merged Count */
            merged_count: number;
            /** Metadata Available */
            metadata_available: boolean;
            /** Note Count */
            note_count: number;
            /** Pace Seconds Per Page */
            pace_seconds_per_page: number | null;
            /** Pace Seconds Per Percent */
            pace_seconds_per_percent: number | null;
            /** Pages */
            pages: number;
            /** Percent Finished */
            percent_finished: number | null;
            /** Progress */
            progress: number | null;
            /** Recent Activity */
            recent_activity: components["schemas"]["RecentActivity"][];
            /**
             * Recent Activity Devices
             * @default []
             */
            recent_activity_devices?: components["schemas"]["DeviceLabel"][];
            /** Recent Sessions */
            recent_sessions: components["schemas"]["ReadingSession"][];
            /** Series */
            series: string;
            /** Series Index */
            series_index: number | null;
            /** Source Book Ids */
            source_book_ids: string[];
            /** Source Md5S */
            source_md5s: string[];
            /** Status */
            status: ("reading" | "complete" | "abandoned" | "unread") | null;
            /** Status Modified */
            status_modified: string | null;
            /** Time Label */
            time_label: string;
            /** Time Seconds */
            time_seconds: number;
            /** Title */
            title: string;
            /** Total Pages */
            total_pages: number | null;
        };
        /** Calendar */
        Calendar: {
            /** Days */
            days: components["schemas"]["CalendarDay"][];
            /** End Date */
            end_date: string | null;
            /** Max Minutes */
            max_minutes: number;
            /** Start Date */
            start_date: string | null;
            /** Total Days */
            total_days: number;
        };
        /** CalendarDay */
        CalendarDay: {
            /** Book Ids */
            book_ids: string[];
            /** Date */
            date: string;
            /** Label */
            label: string;
            /**
             * Level
             * @enum {integer}
             */
            level: 0 | 1 | 2 | 3 | 4;
            /** Minutes */
            minutes: number;
            /** Pages */
            pages: number;
            /** Time Label */
            time_label: string;
        };
        /** CandidateStatus */
        CandidateStatus: {
            /** Error */
            error: string | null;
            /** Exists */
            exists: boolean;
            /** Path */
            path: string;
            /** Readable */
            readable: boolean;
        };
        /** Charts */
        Charts: {
            calendar: components["schemas"]["Calendar"];
            /** Daily */
            daily: components["schemas"]["RecentActivity"][];
            /**
             * Daily By Device
             * @default []
             */
            daily_by_device?: {
                [key: string]: string | number;
            }[];
            /**
             * Devices
             * @default []
             */
            devices?: components["schemas"]["DeviceLabel"][];
            /** Monthly */
            monthly: components["schemas"]["MonthlyActivity"][];
            /**
             * Monthly By Device
             * @default []
             */
            monthly_by_device?: {
                [key: string]: string | number;
            }[];
            /** Top Books */
            top_books: components["schemas"]["TopBook"][];
        };
        /** Dashboard */
        Dashboard: {
            /** Books */
            books: components["schemas"]["BookStats"][];
            charts: components["schemas"]["Charts"];
            /** Has Data */
            has_data: boolean;
            insights: components["schemas"]["Insights"];
            /** Recent Books */
            recent_books: components["schemas"]["BookStats"][];
            snapshot: components["schemas"]["Snapshot"] | null;
            summary: components["schemas"]["Summary"];
        };
        /** DeviceAssignmentRequest */
        DeviceAssignmentRequest: {
            /** Device Id */
            device_id?: string | null;
            /** New Device Label */
            new_device_label?: string | null;
        };
        /** DeviceLabel */
        DeviceLabel: {
            /** Id */
            id: string;
            /** Label */
            label: string;
        };
        /** DeviceRecord */
        DeviceRecord: {
            /** First Seen */
            first_seen?: string | null;
            /** Id */
            id: string;
            /** Koreader Version */
            koreader_version?: string | null;
            /** Label */
            label: string;
            /** Last Seen */
            last_seen?: string | null;
            /** Model */
            model: string | null;
            /** Source */
            source: string;
        };
        /** DeviceResponse */
        DeviceResponse: {
            device: components["schemas"]["DeviceRecord"];
        };
        /** DeviceStatus */
        DeviceStatus: {
            /** Candidates */
            candidates: components["schemas"]["CandidateStatus"][];
            /** Database Found */
            database_found: boolean;
            /** Mount Path */
            mount_path: string;
            /** Mounted */
            mounted: boolean;
            /** Permission Error */
            permission_error: string | null;
            /**
             * Searched Mount Paths
             * @default []
             */
            searched_mount_paths?: string[];
            /** Selected Path */
            selected_path: string | null;
        };
        /** DeviceSummary */
        DeviceSummary: {
            /** Backup Count */
            backup_count: number;
            /** First Seen */
            first_seen?: string | null;
            /** Id */
            id: string;
            /** Koreader Version */
            koreader_version?: string | null;
            /** Label */
            label: string;
            /** Last Backup At */
            last_backup_at: string | null;
            /** Last Seen */
            last_seen?: string | null;
            /** Last Snapshot At */
            last_snapshot_at: string | null;
            /** Model */
            model: string | null;
            /** Snapshot Count */
            snapshot_count: number;
            /** Source */
            source: string;
        };
        /** DeviceUpdateRequest */
        DeviceUpdateRequest: {
            /** Label */
            label: string;
        };
        /** DevicesResponse */
        DevicesResponse: {
            /** Devices */
            devices: components["schemas"]["DeviceSummary"][];
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /** ImportResponse */
        ImportResponse: {
            dashboard: components["schemas"]["Dashboard"];
            snapshot: components["schemas"]["Snapshot"];
        };
        /** Insights */
        Insights: {
            sessions: components["schemas"]["SessionInsights"];
        };
        /** MonthlyActivity */
        MonthlyActivity: {
            /** Hours */
            hours: number;
            /** Label */
            label: string;
            /** Month */
            month: string;
            /** Pages */
            pages: number;
        };
        /** ReadingSession */
        ReadingSession: {
            /** Active Seconds */
            active_seconds: number;
            /** Book Count */
            book_count: number;
            /** Book Ids */
            book_ids: string[];
            /** Coverage Percent */
            coverage_percent: number | null;
            /** Device Id */
            device_id?: string | null;
            /** Device Label */
            device_label?: string | null;
            /** Elapsed Seconds */
            elapsed_seconds: number;
            /** Ended At */
            ended_at: string;
            /** Event Count */
            event_count: number;
            /** Pages */
            pages: number | null;
            /** Started At */
            started_at: string;
        };
        /** RecentActivity */
        RecentActivity: {
            /** Date */
            date: string;
            /** Label */
            label: string;
            /** Minutes */
            minutes: number;
            /** Pages */
            pages: number;
        } & {
            [key: string]: string | number;
        };
        /** RecoveryBackup */
        RecoveryBackup: {
            /** Archive Path */
            archive_path: string;
            /** Archive Size */
            archive_size: number;
            /** Content Hash */
            content_hash: string;
            /** Counts */
            counts: {
                [key: string]: number;
            };
            /** Created At */
            created_at: string;
            /** Credentials Included */
            credentials_included: boolean;
            /** Device Id */
            device_id?: string | null;
            /** Device Label */
            device_label?: string | null;
            /** Device Model */
            device_model: string | null;
            /**
             * Document Metadata Folder
             * @enum {string}
             */
            document_metadata_folder: "doc" | "dir" | "hash";
            /** Format Version */
            format_version: number | null;
            /** Id */
            id: string;
            /** Koreader Version */
            koreader_version: string | null;
            /** Source */
            source: string;
            /** Source Mount */
            source_mount: string;
        };
        /** RestoreCandidate */
        RestoreCandidate: {
            /** Authors */
            authors: string | null;
            /** Doc Path */
            doc_path: string;
            /** Partial Md5 Checksum */
            partial_md5_checksum: string;
            /** Path */
            path: string;
            /** Title */
            title: string;
        };
        /** RestoreFailure */
        RestoreFailure: {
            /** Error */
            error: string;
            /** Path */
            path: string;
        };
        /** RestoreMatch */
        RestoreMatch: {
            /** Authors */
            authors: string | null;
            /**
             * Candidates
             * @default []
             */
            candidates?: components["schemas"]["RestoreCandidate"][];
            /**
             * Fallback Candidates
             * @default []
             */
            fallback_candidates?: components["schemas"]["RestoreCandidate"][];
            /** New Doc Path */
            new_doc_path?: string | null;
            /** New Path */
            new_path?: string | null;
            /** Old Doc Path */
            old_doc_path: string | null;
            /** Partial Md5 Checksum */
            partial_md5_checksum: string | null;
            /** Source Path */
            source_path: string | null;
            /** Title */
            title: string | null;
        };
        /** RestorePreview */
        RestorePreview: {
            /** Ambiguous Matches */
            ambiguous_matches: components["schemas"]["RestoreMatch"][];
            /** Available Bytes */
            available_bytes: number;
            backup: components["schemas"]["RecoveryBackup"];
            /** Book Count */
            book_count: number;
            /** Counts */
            counts: {
                [key: string]: number;
            };
            current_device?: components["schemas"]["DeviceRecord"] | null;
            /** Current Koreader Version */
            current_koreader_version: string | null;
            device: components["schemas"]["DeviceStatus"];
            /**
             * Device Warning
             * @default false
             */
            device_warning?: boolean;
            /** Exact Matches */
            exact_matches: components["schemas"]["RestoreMatch"][];
            /** Missing Matches */
            missing_matches: components["schemas"]["RestoreMatch"][];
            /** Required Bytes */
            required_bytes: number;
            /** Version Warning */
            version_warning: boolean;
        };
        /** RestoreRequest */
        RestoreRequest: {
            /**
             * Confirmed
             * @default false
             */
            confirmed?: boolean;
            /**
             * Restore Optional Extensions
             * @default false
             */
            restore_optional_extensions?: boolean;
        };
        /** RestoreResult */
        RestoreResult: {
            /** Failed */
            failed: components["schemas"]["RestoreFailure"][];
            /** Restart Required */
            restart_required: boolean;
            /** Restored */
            restored: {
                [key: string]: number;
            };
            /** Safety Backup Id */
            safety_backup_id: string;
            /** Skipped */
            skipped: {
                [key: string]: number;
            };
        };
        /** SessionInsights */
        SessionInsights: {
            /** Available */
            available: boolean;
            /** Average Active Seconds */
            average_active_seconds: number;
            /** Longest Active Seconds */
            longest_active_seconds: number;
            /** Recent */
            recent: components["schemas"]["ReadingSession"][];
            /** Total */
            total: number;
        };
        /** Snapshot */
        Snapshot: {
            /** Content Hash */
            content_hash?: string | null;
            /** Device Id */
            device_id?: string | null;
            /** Device Label */
            device_label?: string | null;
            /** Device Model */
            device_model?: string | null;
            /** File Size */
            file_size: number;
            /** Id */
            id: string;
            /** Imported At */
            imported_at: string;
            /** Path */
            path: string;
            /** Schema Version */
            schema_version: string;
            /** Sidecar Hash */
            sidecar_hash?: string | null;
            /** Sidecar Path */
            sidecar_path?: string | null;
            /** Source */
            source: string;
            /** Source Path */
            source_path: string | null;
            /** User Version */
            user_version: number;
        };
        /** SnapshotResponse */
        SnapshotResponse: {
            snapshot: components["schemas"]["Snapshot"];
        };
        /** SnapshotsResponse */
        SnapshotsResponse: {
            /** Snapshots */
            snapshots: components["schemas"]["Snapshot"][];
        };
        /** Summary */
        Summary: {
            /** Abandoned Books */
            abandoned_books: number;
            /** Books */
            books: number;
            /** Current Streak */
            current_streak: number;
            /** Finished Books */
            finished_books: number;
            /** Highlights */
            highlights: number;
            /** Pages */
            pages: number;
            /** Reading Books */
            reading_books: number;
            /** Reading Days */
            reading_days: number;
            /** Total Time Label */
            total_time_label: string;
            /** Total Time Seconds */
            total_time_seconds: number;
            /** Unread Books */
            unread_books: number;
        };
        /** TopBook */
        TopBook: {
            /** Hours */
            hours: number;
            /** Id */
            id: string;
            /** Title */
            title: string;
        };
        /** ValidationError */
        ValidationError: {
            /** Context */
            ctx?: Record<string, never>;
            /** Input */
            input?: unknown;
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    get_backups_api_backups_get: {
        parameters: {
            query?: {
                device_id?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BackupsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    post_backup_kobo_api_backups_kobo_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BackupResponse"];
                };
            };
        };
    };
    post_restore_backup_api_backups__backup_id__restore_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                backup_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RestoreRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RestoreResult"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_restore_preview_api_backups__backup_id__restore_preview_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                backup_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RestorePreview"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_cover_api_covers__asset_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                asset_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_dashboard_api_dashboard_get: {
        parameters: {
            query?: {
                snapshot_id?: string;
                device_id?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Dashboard"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_device_status_api_device_status_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeviceStatus"];
                };
            };
        };
    };
    get_devices_api_devices_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DevicesResponse"];
                };
            };
        };
    };
    patch_device_api_devices__device_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                device_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DeviceUpdateRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeviceResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    post_import_kobo_api_import_kobo_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["DeviceAssignmentRequest"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    post_auto_import_kobo_api_import_kobo_auto_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AutoImportResult"];
                };
            };
        };
    };
    post_import_upload_api_import_upload_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_post_import_upload_api_import_upload_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_snapshots_api_snapshots_get: {
        parameters: {
            query?: {
                device_id?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SnapshotsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    patch_snapshot_device_api_snapshots__snapshot_id__device_patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                snapshot_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DeviceAssignmentRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SnapshotResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
}
