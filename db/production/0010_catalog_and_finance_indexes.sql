-- Preserve authorization semantics while reducing per-row auth calls and redundant OR policies.
ALTER POLICY own_visible_bookmarks ON public.content_bookmarks TO authenticated USING (
 user_id=(SELECT auth.uid()) AND (SELECT public.current_student_eligible()) AND EXISTS(
 SELECT 1 FROM public.content_items c WHERE c.id=content_bookmarks.content_id AND c.status='published' AND public.creator_can_view_published(c.creator_id))
);
ALTER POLICY read_approved_creator_public_profile ON public.creator_public_profiles TO anon;
ALTER POLICY read_own_creator_public_profile ON public.creator_public_profiles TO authenticated USING (
 user_id=(SELECT auth.uid()) OR public.creator_has_approved_public_work(user_id)
);
-- Cover high-frequency foreign key joins in commerce, catalog and payout review.
CREATE INDEX IF NOT EXISTS wk_live_charge_order_idx ON live_finance.charge_inbox(order_id);
CREATE INDEX IF NOT EXISTS wk_live_journal_order_idx ON live_finance.journal(order_id);
CREATE INDEX IF NOT EXISTS wk_live_journal_tx_order_idx ON live_finance.journal(transaction_id,order_id);
CREATE INDEX IF NOT EXISTS wk_live_learning_inbox_order_idx ON live_finance.learning_inbox(order_id);
CREATE INDEX IF NOT EXISTS wk_live_learning_journal_tx_order_idx ON live_finance.learning_journal(transaction_id,order_id);
CREATE INDEX IF NOT EXISTS wk_live_learning_creator_idx ON live_finance.learning_orders(creator_id);
CREATE INDEX IF NOT EXISTS wk_live_reversals_order_idx ON live_finance.reversals(order_id);
CREATE INDEX IF NOT EXISTS wk_live_payout_review_idx ON live_finance.payout_requests(reviewer_id);
CREATE INDEX IF NOT EXISTS wk_content_assets_content_idx ON public.content_assets(content_id);
CREATE INDEX IF NOT EXISTS wk_content_creator_institution_idx ON public.content_items(creator_id,institution_id);
CREATE INDEX IF NOT EXISTS wk_content_course_institution_idx ON public.content_items(course_id,institution_id);
CREATE INDEX IF NOT EXISTS wk_entitlement_order_buyer_content_idx ON public.entitlements(order_id,buyer_id,content_id);
CREATE INDEX IF NOT EXISTS wk_orders_listing_content_creator_idx ON public.orders(listing_id,content_id,creator_id);
CREATE INDEX IF NOT EXISTS wk_payment_attempt_order_idx ON public.payment_attempts(order_id);
CREATE INDEX IF NOT EXISTS wk_access_review_order_idx ON public.social_creator_access_review_cases(order_id);
CREATE INDEX IF NOT EXISTS wk_bookmark_content_idx ON public.content_bookmarks(content_id);
