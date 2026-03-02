# ===== 建構階段 =====
# 使用官方 Maven + JDK 17 映像檔進行編譯，確保版本一致性
FROM maven:3.9.6-eclipse-temurin-17 AS builder

WORKDIR /app

# 先複製 pom.xml 並下載依賴，利用 Docker 快取層避免每次重新下載
COPY pom.xml .
RUN mvn dependency:go-offline -B

# 複製原始碼並進行編譯（跳過測試以加快建構速度）
COPY src ./src
RUN mvn clean package -DskipTests -B

# ===== 執行階段 =====
# 使用較小的 JRE Alpine 映像檔，減少最終映像檔大小
FROM eclipse-temurin:17-jre-alpine

WORKDIR /app

# 從建構階段複製編譯好的 JAR 檔案
COPY --from=builder /app/target/*.jar app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "app.jar"]
