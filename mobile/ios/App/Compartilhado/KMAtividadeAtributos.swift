import Foundation
import ActivityKit

/**
 * Atividade ao Vivo do KM Check: o KM da rodovia na tela bloqueada, na Ilha Dinâmica e no painel do CarPlay
 * (iOS 26, ao lado do mapa). Este arquivo entra nos DOIS alvos: no app, que liga e atualiza o cartão
 * (App/KMAtividade.swift), e na extensão KMCheckAtividade, que o desenha. O sistema passa o estado de um para o
 * outro em JSON, então os dois precisam exatamente do mesmo tipo.
 */
@available(iOS 16.1, *)
struct KMAtividadeAtributos: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var br: String       // "BR-304"
        var uf: String       // "RN"
        var km: Double       // 41.35
        var estaca: String   // "2067+10" ("" = sem estaca)
        var sentido: Int     // 1 crescente, -1 decrescente, 0 ainda não sabe (o KM não andou)
        var dupla: Bool      // trecho de pista dupla no SNV
        var fora: Bool       // longe do eixo (mais que a distância de alerta dos Ajustes) ou fora das rodovias enviadas
    }
}
