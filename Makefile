.PHONY: build up down restart logs shell clean prune dev start

# ビルド
build:
	docker compose build

# 起動（デタッチモード）
up:
	docker compose up -d

# ビルド＆起動
up-build:
	docker compose up -d --build

# 停止
down:
	docker compose down

# 再起動
restart:
	docker compose restart

# ログ表示
logs:
	docker compose logs -f

# コンテナに入る
shell:
	docker compose exec aurora-code sh

# コンテナ・ボリューム削除
clean:
	docker compose down -v --rmi local

# 未使用リソース削除
prune:
	docker system prune -f

# 開発サーバー起動
dev:
	docker compose exec aurora-code bun run dev

# 本番サーバー起動
start:
	docker compose exec aurora-code bun run start

f:
	docker compose exec aurora-code bash
