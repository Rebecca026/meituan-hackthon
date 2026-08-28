FROM maven:3.9-eclipse-temurin-21-alpine AS builder
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn clean package -DskipTests -q && mv target/*.jar app.jar

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
RUN apk add --no-cache curl tzdata
COPY --from=builder /app/app.jar .
EXPOSE 8081
ENTRYPOINT ["java", "-jar", "app.jar"]
