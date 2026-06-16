# Sistem Pengaduan Masyarakat Digital (Cloud-Native)

Sistem Pengaduan Masyarakat Digital adalah sebuah aplikasi pelayanan publik berbasis web yang dirancang menggunakan pendekatan arsitektur *cloud-native*. Aplikasi ini memfasilitasi masyarakat dalam menyampaikan laporan secara transparan, aman, dan efisien.

Proyek ini dibuat untuk memenuhi **SDGs Poin 16** (*Peace, Justice and Strong Institutions*) dengan memanfaatkan ekosistem **Microsoft Azure** dan **Kubernetes**.

## 🏗️ Arsitektur Sistem

Aplikasi ini menggunakan teknologi container dan diorkestrasi oleh Kubernetes untuk memastikan ketersediaan tinggi (*high availability*) dan skalabilitas otomatis.
*   **Aplikasi (Backend/Frontend)**: Node.js (Express & EJS)
*   **Orkestrasi Container**: Azure Kubernetes Service (AKS)
*   **Database**: PostgreSQL (Di-deploy ke dalam Cluster Kubernetes)
*   **Penyimpanan Berkas (Foto Laporan)**: Azure Blob Storage
*   **Registry Image**: Azure Container Registry (ACR)

## 🛠️ Prasyarat (Prerequisites)

Sebelum melakukan deployment, pastikan Anda telah menyiapkan layanan berikut:
1.  Cluster **Azure Kubernetes Service (AKS)** yang sudah berjalan.
2.  **Azure Container Registry (ACR)** untuk menyimpan Docker Image.
3.  **Azure Storage Account** dan Container (Blob) dengan akses publik untuk menyimpan unggahan foto laporan.
4.  Akses command line ke `kubectl` dan `az cli`.

## 🚀 Panduan Deployment (Kubernetes)

### 1. Hubungkan ke Azure
Login ke Azure dan sambungkan `kubectl` ke cluster AKS Anda:
```bash
az login
az aks get-credentials --resource-group <NAMA_RESOURCE_GROUP> --name <NAMA_AKS_CLUSTER>
```

### 2. Build & Push Docker Image
Lakukan build container aplikasi dan push ke ACR Anda:
```bash
az acr login --name <NAMA_ACR>
docker build -t <NAMA_ACR>.azurecr.io/pengaduan-app:v2 .
docker push <NAMA_ACR>.azurecr.io/pengaduan-app:v2
```

### 3. Konfigurasi Rahasia (Secrets)
Sebelum menjalankan deployment, edit file `deployment.yaml` dan ganti nilai `<YOUR_AZURE_STORAGE_CONNECTION_STRING>` dengan *Connection String* milik Azure Storage Account Anda.

### 4. Aplikasikan Manifest Kubernetes
Terapkan *Database*, *Aplikasi*, *Service*, dan *Autoscaling* secara berurutan:
```bash
# Deploy Database PostgreSQL
kubectl apply -f postgres.yaml

# Deploy Aplikasi Pengaduan
kubectl apply -f deployment.yaml

# Deploy LoadBalancer Service
kubectl apply -f service.yaml

# Mengaktifkan Horizontal Pod Autoscaler (HPA)
kubectl apply -f hpa.yaml
```

### 5. Verifikasi Deployment
Periksa status Pods dan dapatkan alamat IP Publik dari Service Anda:
```bash
kubectl get pods
kubectl get svc sdgs-service
```
Buka `EXTERNAL-IP` yang muncul di browser Anda untuk mengakses aplikasi!

---
*Proyek ini merupakan bagian dari Evaluasi Tengah Semester (ETS) Cloud Computing - Institut Teknologi Nasional Bandung.*
