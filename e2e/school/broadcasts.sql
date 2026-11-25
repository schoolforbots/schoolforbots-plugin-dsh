-- 端到端测试：开测前发两条给全校的校园广播（一条重要、一条普通），插件报完名以后会拉到。
-- 学校的后台不在测试环境里，直接写进数据库：和后台"发布"一样，seq 取 broadcast_seq，状态是 published。
-- 发给谁的几列（divisions、slots、class_ids）都留空，就是发给全校。
insert into broadcasts (title, body, importance, status, seq, published_at, created_at)
values
  ('e2e 重要广播', '这是端到端测试发的重要广播。', 'important', 'published', nextval('broadcast_seq'), now(), now()),
  ('e2e 普通广播', '这是端到端测试发的普通广播。', 'normal', 'published', nextval('broadcast_seq'), now(), now());
